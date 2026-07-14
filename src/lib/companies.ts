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

export const SEO_SCOPES = ["company_domain", "business_location"] as const;
export type SeoScope = (typeof SEO_SCOPES)[number];

/** Ahrefs batch-analysis `mode` values. */
export type AhrefsTargetMode = "domain" | "prefix" | "subdomains" | "exact";

export type ParsedWebsite = {
  input: string;
  hostname: string;
  displayHost: string;
  rootDomain: string;
  pathname: string;
  fullUrl: string;
  isSubdomain: boolean;
  hasLocationPath: boolean;
  pathClassification: "none" | "meaningful" | "meaningless" | "uncertain";
};

export type SeoAnalysisPull = {
  scope: SeoScope;
  analysisTarget: string;
  analysisMode: AnalysisMode;
  parentDomain: string;
  locationPath: string | null;
};

const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "co.uk",
  "com.au",
  "co.nz",
  "com.br",
  "co.jp",
]);

const MEANINGLESS_PATHS = new Set([
  "",
  "/",
  "/home",
  "/home/",
  "/index",
  "/index/",
  "/index.html",
  "/index.htm",
  "/index.php",
  "/default.aspx",
]);

const LANGUAGE_ONLY_PATH =
  /^\/(?:[a-z]{2}|[a-z]{2}-[a-z]{2})(?:\/)?$/i;

const LOCATIONISH_PATH =
  /(?:^\/)(?:[a-z0-9-]+(?:-[a-z]{2})?|(?:locations?|areas?|cities?|branches?)(?:\/[a-z0-9-]+)+)/i;

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

export function classifyPath(
  pathname: string,
): ParsedWebsite["pathClassification"] {
  const raw = pathname.toLowerCase();
  const normalized = raw.replace(/\/+$/, "") || "/";
  const withSlash = normalized === "/" ? "/" : `${normalized}/`;
  if (
    MEANINGLESS_PATHS.has(normalized) ||
    MEANINGLESS_PATHS.has(withSlash) ||
    MEANINGLESS_PATHS.has(raw)
  ) {
    return "none";
  }
  if (LANGUAGE_ONLY_PATH.test(normalized) || LANGUAGE_ONLY_PATH.test(withSlash)) {
    return "uncertain";
  }
  const last = normalized.split("/").filter(Boolean).pop() ?? "";
  if (
    LOCATIONISH_PATH.test(normalized) ||
    /-[a-z]{2}$/i.test(last) ||
    /^(?:boise|meridian|nampa|caldwell|eagle|kuna|star|garden-city)/i.test(last)
  ) {
    return "meaningful";
  }
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length >= 1) {
    return "uncertain";
  }
  return "none";
}

export function parseWebsite(
  input: string | null | undefined,
): ParsedWebsite | null {
  if (!input?.trim()) return null;
  let raw = input.trim();
  try {
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
    const url = stripTrackingParams(new URL(raw));
    const displayHost = url.hostname.toLowerCase().replace(/\.$/, "");
    const hostNoWww = displayHost.replace(/^www\./, "");
    const rootDomain = extractRootDomain(hostNoWww);
    const pathname = url.pathname || "/";
    const pathClassification = classifyPath(pathname);
    const hasLocationPath = pathClassification === "meaningful";

    const isSubdomain =
      hostNoWww !== rootDomain && hostNoWww.endsWith(`.${rootDomain}`);

    let pathOut = pathname;
    if (hasLocationPath && !pathname.includes(".") && !pathOut.endsWith("/")) {
      pathOut = `${pathOut}/`;
    }
    const fullUrl = `https://${displayHost}${pathOut === "/" ? "/" : pathOut}`;

    return {
      input: input.trim(),
      hostname: hostNoWww,
      displayHost,
      rootDomain,
      pathname,
      fullUrl,
      isSubdomain,
      hasLocationPath,
      pathClassification,
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

/**
 * Resolve Ahrefs pulls for a website.
 * Always includes parent company_domain when parseable.
 * Adds business_location when path or subdomain is meaningful.
 */
export function resolveSeoAnalysisPulls(
  websiteUrl: string | null | undefined,
): {
  pulls: SeoAnalysisPull[];
  needsManualReview: boolean;
  reason: string | null;
  parsed: ParsedWebsite | null;
} {
  const parsed = parseWebsite(websiteUrl);
  if (!parsed) {
    return {
      pulls: [],
      needsManualReview: true,
      reason: "missing_or_unparseable_website",
      parsed: null,
    };
  }

  const parentPull: SeoAnalysisPull = {
    scope: "company_domain",
    analysisTarget: parsed.rootDomain,
    analysisMode: "domain",
    parentDomain: parsed.rootDomain,
    locationPath: null,
  };

  if (parsed.isSubdomain) {
    return {
      pulls: [
        parentPull,
        {
          scope: "business_location",
          analysisTarget: parsed.hostname,
          analysisMode: "subdomain",
          parentDomain: parsed.rootDomain,
          locationPath: null,
        },
      ],
      needsManualReview: false,
      reason: null,
      parsed,
    };
  }

  if (parsed.pathClassification === "meaningful") {
    const path =
      parsed.pathname.endsWith("/") || parsed.pathname.includes(".")
        ? parsed.pathname
        : `${parsed.pathname}/`;
    return {
      pulls: [
        parentPull,
        {
          scope: "business_location",
          analysisTarget: parsed.fullUrl,
          analysisMode: "prefix",
          parentDomain: parsed.rootDomain,
          locationPath: path,
        },
      ],
      needsManualReview: false,
      reason: null,
      parsed,
    };
  }

  if (parsed.pathClassification === "uncertain") {
    return {
      pulls: [parentPull],
      needsManualReview: true,
      reason: "uncertain_location_path",
      parsed,
    };
  }

  return {
    pulls: [parentPull],
    needsManualReview: false,
    reason: null,
    parsed,
  };
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

  const resolved = resolveSeoAnalysisPulls(parsed.input);
  const location = resolved.pulls.find((p) => p.scope === "business_location");
  if (location) {
    return {
      analysisMode: location.analysisMode,
      analysisTarget: location.analysisTarget,
      needsManualReview: resolved.needsManualReview,
      reason: resolved.reason,
    };
  }

  if (shareCount > 1 && !parsed.hasLocationPath && !parsed.isSubdomain) {
    return {
      analysisMode: "domain",
      analysisTarget: parsed.rootDomain,
      needsManualReview: true,
      reason: "shared_domain_without_location_target",
    };
  }

  return {
    analysisMode: "domain",
    analysisTarget: parsed.rootDomain,
    needsManualReview: resolved.needsManualReview,
    reason: resolved.reason,
  };
}

export function determineCompanyType(input: {
  shareCount: number;
  hasWebsite: boolean;
  anyPrefixOrSubdomain: boolean;
}): CompanyType {
  if (!input.hasWebsite) return "unknown";
  if (input.shareCount <= 1) {
    return input.anyPrefixOrSubdomain ? "franchise" : "independent";
  }
  if (input.anyPrefixOrSubdomain) return "franchise";
  return "multi_location";
}

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
