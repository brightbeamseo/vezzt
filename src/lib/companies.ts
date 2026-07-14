/**
 * Company ↔ business location helpers.
 * Google Place IDs stay unique on businesses; companies only group ownership.
 */

import { MARKETS } from "@/lib/markets";

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

export const COMPANY_SCALES = [
  "single_location",
  "multi_location",
  "regional",
  "national",
  "unknown",
] as const;

export type CompanyScale = (typeof COMPANY_SCALES)[number];

export const OWNERSHIP_MODELS = [
  "independent",
  "franchise",
  "corporate_chain",
  "unknown",
] as const;

export type OwnershipModel = (typeof OWNERSHIP_MODELS)[number];

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

export type CompanyLocationEvidence = {
  id: string;
  city: string | null;
  state: string | null;
  websiteUrl: string | null;
  marketId?: string | null;
};

export type CompanyClassification = {
  companyScale: CompanyScale;
  ownershipModel: OwnershipModel;
  locationCount: number;
  serviceStates: string[];
  serviceMarkets: string[];
  classificationConfidence: number;
  classificationReason: string;
  needsManualReview: boolean;
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

function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return [
    ...new Set(
      values
        .map((v) => (v ?? "").trim())
        .filter(Boolean)
        .map((v) => v.replace(/\s+/g, " ")),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

/**
 * Classify company scale + ownership from linked locations and URL structure.
 * Does not use company name as the sole signal.
 */
export function classifyCompany(input: {
  locations: CompanyLocationEvidence[];
  rootDomain: string | null;
  metroCityAllowlist?: string[];
}): CompanyClassification {
  const { locations, rootDomain } = input;
  const metro = new Set(
    (input.metroCityAllowlist ?? MARKETS["boise-metro"].cities).map((c) =>
      c.trim().toLowerCase(),
    ),
  );

  const locationCount = locations.length;
  const states = uniqueSorted(locations.map((l) => l.state));
  const cities = uniqueSorted(locations.map((l) => l.city));
  const markets = uniqueSorted(
    locations.map((l) => l.marketId).filter(Boolean) as string[],
  );

  const parsedSites = locations
    .map((l) => parseWebsite(l.websiteUrl))
    .filter((p): p is ParsedWebsite => Boolean(p));

  const anyLocationPath = parsedSites.some(
    (p) => p.pathClassification === "meaningful",
  );
  const anySubdomain = parsedSites.some((p) => p.isSubdomain);
  const anyUncertainPath = parsedSites.some(
    (p) => p.pathClassification === "uncertain",
  );
  const hasFranchiseUrlPattern = anyLocationPath || anySubdomain;

  let ownershipModel: OwnershipModel = "unknown";
  let ownershipReason = "insufficient ownership evidence";
  if (locationCount === 0) {
    ownershipModel = "unknown";
    ownershipReason = "no linked locations";
  } else if (hasFranchiseUrlPattern) {
    ownershipModel = "franchise";
    ownershipReason = anySubdomain
      ? "location subdomain under shared parent domain"
      : "location path under shared parent domain";
  } else if (
    locationCount >= 5 &&
    states.length >= 3 &&
    !hasFranchiseUrlPattern
  ) {
    ownershipModel = "corporate_chain";
    ownershipReason =
      "multiple locations across several states without franchise URL patterns";
  } else if (locationCount >= 1 && !hasFranchiseUrlPattern) {
    ownershipModel = "independent";
    ownershipReason =
      "local website without franchise path/subdomain evidence";
  }

  let companyScale: CompanyScale = "unknown";
  let scaleReason = "insufficient footprint evidence";
  const citiesInMetro = cities.filter((c) => metro.has(c.toLowerCase()));
  const citiesOutsideMetro = cities.filter((c) => !metro.has(c.toLowerCase()));

  if (locationCount <= 0) {
    companyScale = "unknown";
    scaleReason = "no linked locations";
  } else if (states.length > 10) {
    companyScale = "national";
    scaleReason = `${states.length} service states from linked locations`;
  } else if (states.length >= 2 && states.length <= 10) {
    companyScale = "regional";
    scaleReason = `locations across ${states.length} states`;
  } else if (citiesOutsideMetro.length > 0 && citiesInMetro.length > 0) {
    companyScale = "regional";
    scaleReason = "locations span multiple metros/markets";
  } else if (locationCount >= 2 && citiesOutsideMetro.length === 0) {
    companyScale = "multi_location";
    scaleReason = `${locationCount} locations in one metro / nearby cities`;
  } else if (locationCount === 1 && !hasFranchiseUrlPattern) {
    companyScale = "single_location";
    scaleReason = "one linked location with no multi-location URL evidence";
  } else if (locationCount === 1 && hasFranchiseUrlPattern) {
    companyScale = "national";
    scaleReason =
      "franchise location URL pattern with only one location in dataset (nationwide footprint likely; verify)";
  }

  let confidence = 0.5;
  if (companyScale === "single_location" && ownershipModel === "independent") {
    confidence = 0.85;
  } else if (companyScale === "multi_location" && locationCount >= 2) {
    confidence = 0.8;
  } else if (companyScale === "regional" && states.length >= 2) {
    confidence = 0.75;
  } else if (companyScale === "national" && states.length > 10) {
    confidence = 0.85;
  } else if (
    companyScale === "national" &&
    hasFranchiseUrlPattern &&
    locationCount === 1
  ) {
    confidence = 0.55;
  } else if (ownershipModel === "franchise" && hasFranchiseUrlPattern) {
    confidence = Math.max(confidence, 0.7);
  } else if (!rootDomain) {
    confidence = 0.35;
  }

  if (anyUncertainPath) confidence = Math.min(confidence, 0.55);

  const needsManualReview =
    confidence < 0.7 ||
    companyScale === "unknown" ||
    ownershipModel === "unknown" ||
    (hasFranchiseUrlPattern && locationCount === 1) ||
    anyUncertainPath ||
    !rootDomain;

  const classificationReason = [
    `scale: ${scaleReason}`,
    `ownership: ${ownershipReason}`,
    `locations=${locationCount}`,
    states.length ? `states=${states.join("|")}` : null,
    cities.length ? `cities=${cities.join("|")}` : null,
    rootDomain ? `root_domain=${rootDomain}` : "root_domain=missing",
  ]
    .filter(Boolean)
    .join("; ");

  return {
    companyScale,
    ownershipModel,
    locationCount,
    serviceStates: states,
    serviceMarkets:
      markets.length > 0
        ? markets
        : citiesInMetro.length > 0
          ? ["boise-metro"]
          : [],
    classificationConfidence: Number(confidence.toFixed(2)),
    classificationReason,
    needsManualReview,
  };
}

/** Whether Ahrefs should fetch a local path/subdomain pull given company scale. */
export function shouldFetchLocalSeoPull(input: {
  companyScale: CompanyScale | null | undefined;
  ownershipModel: OwnershipModel | null | undefined;
  parsed: ParsedWebsite | null;
}): boolean {
  if (!input.parsed) return false;
  if (input.parsed.isSubdomain) return true;

  const scale = input.companyScale ?? "unknown";
  const ownership = input.ownershipModel ?? "unknown";

  if (scale === "single_location" && ownership === "independent") {
    return false;
  }

  if (input.parsed.pathClassification !== "meaningful") return false;

  if (
    scale === "multi_location" ||
    scale === "regional" ||
    scale === "national" ||
    ownership === "franchise" ||
    ownership === "corporate_chain"
  ) {
    return true;
  }

  return false;
}

/**
 * Resolve Ahrefs pulls using website structure + company scale/ownership.
 */
export function resolveSeoAnalysisPulls(
  websiteUrl: string | null | undefined,
  options?: {
    companyScale?: CompanyScale | null;
    ownershipModel?: OwnershipModel | null;
  },
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

  const fetchLocal = shouldFetchLocalSeoPull({
    companyScale: options?.companyScale,
    ownershipModel: options?.ownershipModel,
    parsed,
  });

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

  if (fetchLocal && parsed.pathClassification === "meaningful") {
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

  if (parsed.pathClassification === "meaningful" && !fetchLocal) {
    return {
      pulls: [parentPull],
      needsManualReview: false,
      reason: "single_location_independent_skips_path_pull",
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
  companyScale?: CompanyScale | null;
  ownershipModel?: OwnershipModel | null;
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

  const resolved = resolveSeoAnalysisPulls(parsed.input, {
    companyScale: input.companyScale,
    ownershipModel: input.ownershipModel,
  });
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
