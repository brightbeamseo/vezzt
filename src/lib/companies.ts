/**
 * Company ↔ business location helpers.
 * Google Place IDs stay unique on businesses; companies only group ownership.
 */

export const COMPANY_TYPES = [
  "independent",
  "franchise",
  "regional",
  "multi_location",
  "unknown",
] as const;

export type CompanyType = (typeof COMPANY_TYPES)[number];

export const ANALYSIS_MODES = [
  "domain",
  "prefix",
  "subdomain",
  "exact_url",
] as const;

export type AnalysisMode = (typeof ANALYSIS_MODES)[number];

/** Ahrefs batch-analysis `mode` values. */
export type AhrefsTargetMode = "domain" | "prefix" | "subdomains" | "exact";

export type ParsedWebsite = {
  input: string;
  hostname: string;
  rootDomain: string;
  pathname: string;
  /** Normalized absolute URL without query/hash. */
  fullUrl: string;
  isSubdomain: boolean;
  /** Path beyond "/" that looks like a location/section prefix. */
  hasLocationPath: boolean;
};

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "com.au",
  "co.nz",
  "com.br",
  "co.jp",
]);

export function stripTrackingParams(url: URL): URL {
  const clean = new URL(url.toString());
  clean.hash = "";
  const drop: string[] = [];
  clean.searchParams.forEach((_v, key) => {
    if (
      key.toLowerCase().startsWith("utm_") ||
      key.toLowerCase() === "gclid" ||
      key.toLowerCase() === "fbclid"
    ) {
      drop.push(key);
    }
  });
  for (const key of drop) clean.searchParams.delete(key);
  return clean;
}

export function parseWebsite(
  input: string | null | undefined,
): ParsedWebsite | null {
  if (!input?.trim()) return null;
  let raw = input.trim();
  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const url = stripTrackingParams(new URL(raw));
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    const hostNoWww = hostname.replace(/^www\./, "");
    const rootDomain = extractRootDomain(hostNoWww);
    const pathname = url.pathname || "/";
    const hasLocationPath =
      pathname.replace(/\/+$/, "") !== "" &&
      pathname !== "/" &&
      !/^\/?(index\.(html?|php))?$/i.test(pathname);

    const isSubdomain =
      hostNoWww !== rootDomain && hostNoWww.endsWith(`.${rootDomain}`);

    // Keep directory slash for franchise city pages; drop query/hash.
    let pathOut = pathname;
    if (hasLocationPath && !pathname.includes(".") && !pathOut.endsWith("/")) {
      pathOut = `${pathOut}/`;
    }
    const fullUrl = `https://${hostname}${pathOut === "/" ? "/" : pathOut}`;

    return {
      input: input.trim(),
      hostname: hostNoWww,
      rootDomain,
      pathname,
      fullUrl,
      isSubdomain,
      hasLocationPath,
    };
  } catch {
    return null;
  }
}

export function extractRootDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_PUBLIC_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

export function determineAnalysis(input: {
  parsed: ParsedWebsite | null;
  shareCount: number;
}): {
  analysisMode: AnalysisMode | null;
  analysisTarget: string | null;
  needsManualReview: boolean;
  reason: string | null;
} {
  const { parsed, shareCount } = input;

  if (!parsed) {
    return {
      analysisMode: null,
      analysisTarget: null,
      needsManualReview: true,
      reason: "missing_or_unparseable_website",
    };
  }

  if (shareCount <= 1) {
    return {
      analysisMode: "domain",
      analysisTarget: parsed.rootDomain,
      needsManualReview: false,
      reason: null,
    };
  }

  // Multiple businesses share this root domain.
  if (parsed.isSubdomain) {
    return {
      analysisMode: "subdomain",
      analysisTarget: parsed.hostname,
      needsManualReview: false,
      reason: null,
    };
  }

  if (parsed.hasLocationPath) {
    return {
      analysisMode: "prefix",
      analysisTarget: parsed.fullUrl,
      needsManualReview: false,
      reason: null,
    };
  }

  // Shared brand domain but no path/subdomain signal — fallback domain + review.
  return {
    analysisMode: "domain",
    analysisTarget: parsed.rootDomain,
    needsManualReview: true,
    reason: "shared_domain_without_location_target",
  };
}

export function determineCompanyType(input: {
  shareCount: number;
  hasWebsite: boolean;
  anyPrefixOrSubdomain: boolean;
}): CompanyType {
  if (!input.hasWebsite) return "unknown";
  if (input.shareCount <= 1) return "independent";
  if (input.anyPrefixOrSubdomain) return "franchise";
  return "multi_location";
}

/** Map Vezzt analysis_mode → Ahrefs batch-analysis mode. */
export function toAhrefsTargetMode(mode: AnalysisMode): AhrefsTargetMode {
  switch (mode) {
    case "prefix":
      return "prefix";
    case "subdomain":
      return "subdomains";
    case "exact_url":
      return "exact";
    case "domain":
    default:
      return "domain";
  }
}
