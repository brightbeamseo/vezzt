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

/**
 * Pull summary SEO metrics for one domain via Batch Analysis.
 * Does not request top pages, keyword lists, or backlink lists.
 */
export async function fetchAhrefsDomainSummary(
  domainInput: string,
): Promise<AhrefsBatchResult> {
  const domain = normalizeAhrefsDomain(domainInput);
  const endpoint = `${AHREFS_BASE}/batch-analysis/batch-analysis`;
  const body = {
    select: [...BATCH_SELECT],
    targets: [
      {
        url: domain,
        mode: "domain",
        protocol: "both",
      },
    ],
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

  const targets = (
    rawResponse as { targets?: Record<string, unknown>[] } | null
  )?.targets;
  const row = Array.isArray(targets) ? targets[0] : undefined;
  if (!row) {
    throw new Error(
      `Ahrefs returned no target row for domain=${domain}: ${JSON.stringify(rawResponse).slice(0, 500)}`,
    );
  }

  return {
    endpoint,
    unitsCost: Number.isFinite(unitsCost) ? unitsCost : null,
    rawResponse,
    metrics: {
      domain,
      domainRating: toNullableNumber(row.domain_rating),
      referringDomains: toNullableInt(row.refdomains),
      backlinks: toNullableInt(row.backlinks),
      organicTraffic: toNullableInt(row.org_traffic),
      organicKeywords: toNullableInt(row.org_keywords),
      organicKeywordsTop3: toNullableInt(row.org_keywords_1_3),
      trafficValue: toNullableNumber(row.org_cost),
    },
  };
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
