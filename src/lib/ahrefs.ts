import type { AnalysisMode } from "@/lib/companies";
import { toAhrefsTargetMode } from "@/lib/companies";

/**
 * Ahrefs API v3 client — summary metrics only (no page/keyword/backlink lists).
 *
 * Auth: Authorization: Bearer <AHREFS_API_KEY>
 * Docs: https://docs.ahrefs.com/en/api/reference/batch-analysis
 */

const AHREFS_BASE = "https://api.ahrefs.com/v3";

const BATCH_SELECT = [
  "url",
  "domain_rating",
  "refdomains",
  "backlinks",
  "org_traffic",
  "org_keywords",
  "org_keywords_1_3",
  "org_cost",
] as const;

export type AhrefsSummaryMetrics = {
  domain: string;
  domainRating: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  organicKeywordsTop3: number | null;
  /** Organic traffic value (Ahrefs org_cost), when present. */
  trafficValue: number | null;
};

export type AhrefsBatchResult = {
  metrics: AhrefsSummaryMetrics;
  rawResponse: unknown;
  unitsCost: number | null;
  endpoint: string;
  analysisMode: AnalysisMode;
  analysisTarget: string;
};

function getApiKey(): string {
  const key = process.env.AHREFS_API_KEY?.trim();
  if (!key) {
    throw new Error("Missing AHREFS_API_KEY in environment.");
  }
  return key;
}

/** Normalize a website URL or hostname to a bare domain (e.g. pointroof.com). */
export function normalizeAhrefsDomain(input: string): string {
  let raw = input.trim().toLowerCase();
  if (!raw) throw new Error("Domain is required.");

  try {
    if (!/^https?:\/\//i.test(raw)) {
      raw = `https://${raw}`;
    }
    const host = new URL(raw).hostname.replace(/^www\./, "");
    if (!host) throw new Error(`Could not parse domain from: ${input}`);
    return host;
  } catch {
    return raw
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]!
      .split("?")[0]!;
  }
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function toNullableInt(value: unknown): number | null {
  const num = toNullableNumber(value);
  return num === null ? null : Math.round(num);
}

function rowToMetrics(
  requestedTarget: string,
  row: Record<string, unknown>,
): AhrefsSummaryMetrics {
  const returnedUrl =
    typeof row.url === "string" ? row.url : requestedTarget;
  const domain = normalizeAhrefsDomain(returnedUrl) || requestedTarget;
  return {
    domain,
    domainRating: toNullableNumber(row.domain_rating),
    referringDomains: toNullableInt(row.refdomains),
    backlinks: toNullableInt(row.backlinks),
    organicTraffic: toNullableInt(row.org_traffic),
    organicKeywords: toNullableInt(row.org_keywords),
    organicKeywordsTop3: toNullableInt(row.org_keywords_1_3),
    trafficValue: toNullableNumber(row.org_cost),
  };
}

export type AhrefsAnalysisTarget = {
  analysisTarget: string;
  analysisMode: AnalysisMode;
};

export type AhrefsMultiBatchResult = {
  endpoint: string;
  unitsCost: number | null;
  rawResponse: unknown;
  /** Keyed by analysis_target string used in the request. */
  byTarget: Map<string, AhrefsSummaryMetrics>;
};

/**
 * Pull summary SEO metrics for analysis targets via Batch Analysis.
 * Uses each row's analysis_mode (domain / prefix / subdomain / exact_url).
 */
export async function fetchAhrefsAnalysisTargets(
  targets: AhrefsAnalysisTarget[],
): Promise<AhrefsMultiBatchResult> {
  if (targets.length === 0) {
    throw new Error("At least one analysis target is required.");
  }

  const endpoint = `${AHREFS_BASE}/batch-analysis/batch-analysis`;
  const body = {
    select: [...BATCH_SELECT],
    // Match Site Explorer US monthly volume (default all-locations can undercount).
    country: "us",
    volume_mode: "monthly" as const,
    targets: targets.map((t) => ({
      url: t.analysisTarget,
      mode: toAhrefsTargetMode(t.analysisMode),
      protocol: "both" as const,
    })),
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const unitsHeader =
    res.headers.get("x-api-units-cost-total-actual") ??
    res.headers.get("x-api-units-cost-total");
  const unitsCost = unitsHeader ? Number(unitsHeader) : null;

  const rawResponse: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(
      `Ahrefs batch-analysis failed (${res.status}): ${JSON.stringify(rawResponse).slice(0, 500)}`,
    );
  }

  const responseTargets = (
    rawResponse as { targets?: Record<string, unknown>[] } | null
  )?.targets;
  if (!Array.isArray(responseTargets) || responseTargets.length === 0) {
    throw new Error(
      `Ahrefs returned no target rows: ${JSON.stringify(rawResponse).slice(0, 500)}`,
    );
  }

  const byTarget = new Map<string, AhrefsSummaryMetrics>();

  for (let i = 0; i < responseTargets.length; i++) {
    const row = responseTargets[i]!;
    const requested = targets[i]?.analysisTarget ?? String(row.url ?? "");
    const metrics = rowToMetrics(requested, row);
    byTarget.set(requested, metrics);
  }

  return {
    endpoint,
    unitsCost: Number.isFinite(unitsCost) ? unitsCost : null,
    rawResponse,
    byTarget,
  };
}

/** @deprecated Prefer fetchAhrefsAnalysisTargets — kept for domain-only scripts. */
export async function fetchAhrefsDomainSummaries(
  domainInputs: string[],
): Promise<{
  endpoint: string;
  unitsCost: number | null;
  rawResponse: unknown;
  byDomain: Map<string, AhrefsSummaryMetrics>;
}> {
  const targets = domainInputs.map((d) => ({
    analysisTarget: normalizeAhrefsDomain(d),
    analysisMode: "domain" as const,
  }));
  const result = await fetchAhrefsAnalysisTargets(targets);
  return {
    endpoint: result.endpoint,
    unitsCost: result.unitsCost,
    rawResponse: result.rawResponse,
    byDomain: result.byTarget,
  };
}

/**
 * Pull summary SEO metrics for one analysis target.
 */
export async function fetchAhrefsByAnalysis(input: {
  analysisTarget: string;
  analysisMode: AnalysisMode;
}): Promise<AhrefsBatchResult> {
  const multi = await fetchAhrefsAnalysisTargets([input]);
  const metrics = multi.byTarget.get(input.analysisTarget);
  if (!metrics) {
    throw new Error(
      `Ahrefs returned no metrics for target=${input.analysisTarget} mode=${input.analysisMode}`,
    );
  }
  return {
    endpoint: multi.endpoint,
    unitsCost: multi.unitsCost,
    rawResponse: multi.rawResponse,
    metrics,
    analysisMode: input.analysisMode,
    analysisTarget: input.analysisTarget,
  };
}

/** @deprecated Prefer fetchAhrefsByAnalysis with analysis_mode from DB. */
export async function fetchAhrefsDomainSummary(
  domainInput: string,
): Promise<AhrefsBatchResult> {
  return fetchAhrefsByAnalysis({
    analysisTarget: normalizeAhrefsDomain(domainInput),
    analysisMode: "domain",
  });
}

export async function fetchAhrefsUsage(): Promise<unknown> {
  const res = await fetch(
    `${AHREFS_BASE}/subscription-info/limits-and-usage`,
    {
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: "application/json",
      },
    },
  );
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Ahrefs limits-and-usage failed (${res.status}): ${JSON.stringify(json).slice(0, 300)}`,
    );
  }
  return json;
}
