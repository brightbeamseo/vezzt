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

function rowToMetrics(
  requestedDomain: string,
  row: Record<string, unknown>,
): AhrefsSummaryMetrics {
  const returnedUrl =
    typeof row.url === "string" ? row.url : requestedDomain;
  const domain = normalizeAhrefsDomain(returnedUrl) || requestedDomain;
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

export type AhrefsMultiBatchResult = {
  endpoint: string;
  unitsCost: number | null;
  rawResponse: unknown;
  /** Keyed by normalized request domain. */
  byDomain: Map<string, AhrefsSummaryMetrics>;
};

/**
 * Pull summary SEO metrics for one or more domains via Batch Analysis.
 * Does not request top pages, keyword lists, or backlink lists.
 */
export async function fetchAhrefsDomainSummaries(
  domainInputs: string[],
): Promise<AhrefsMultiBatchResult> {
  const domains = [
    ...new Set(
      domainInputs.map((d) => normalizeAhrefsDomain(d)).filter(Boolean),
    ),
  ];
  if (domains.length === 0) {
    throw new Error("At least one domain is required.");
  }

  const endpoint = `${AHREFS_BASE}/batch-analysis/batch-analysis`;
  const body = {
    select: [...BATCH_SELECT],
    targets: domains.map((domain) => ({
      url: domain,
      mode: "domain" as const,
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

  const targets = (
    rawResponse as { targets?: Record<string, unknown>[] } | null
  )?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error(
      `Ahrefs returned no target rows: ${JSON.stringify(rawResponse).slice(0, 500)}`,
    );
  }

  const byDomain = new Map<string, AhrefsSummaryMetrics>();

  // Prefer index alignment with request order; also index by returned URL.
  for (let i = 0; i < targets.length; i++) {
    const row = targets[i]!;
    const requested = domains[i] ?? normalizeAhrefsDomain(String(row.url ?? ""));
    const metrics = rowToMetrics(requested, row);
    if (requested) byDomain.set(requested, { ...metrics, domain: requested });
    byDomain.set(metrics.domain, {
      ...metrics,
      domain: metrics.domain,
    });
  }

  return {
    endpoint,
    unitsCost: Number.isFinite(unitsCost) ? unitsCost : null,
    rawResponse,
    byDomain,
  };
}

/**
 * Pull summary SEO metrics for one domain via Batch Analysis.
 */
export async function fetchAhrefsDomainSummary(
  domainInput: string,
): Promise<AhrefsBatchResult> {
  const domain = normalizeAhrefsDomain(domainInput);
  const multi = await fetchAhrefsDomainSummaries([domain]);
  const metrics = multi.byDomain.get(domain);
  if (!metrics) {
    throw new Error(`Ahrefs returned no metrics for domain=${domain}`);
  }
  return {
    endpoint: multi.endpoint,
    unitsCost: multi.unitsCost,
    rawResponse: multi.rawResponse,
    metrics,
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
