/**
 * Ahrefs search_scope: geographic/business interpretation of SEO metrics.
 */

import type {
  AnalysisMode,
  CompanyScale,
  SeoScope,
} from "@/lib/companies";

export const SEARCH_SCOPES = [
  "location",
  "company",
  "mixed",
  "unknown",
] as const;

export type SearchScope = (typeof SEARCH_SCOPES)[number];

export const SEARCH_SCOPE_TOOLTIPS: Record<SearchScope, string> = {
  location:
    "SEO metrics are measured for this specific business location’s path, subdomain, or dedicated site.",
  company:
    "SEO metrics represent the entire company domain. For a single-location company, this usually represents the business accurately.",
  mixed:
    "SEO metrics represent a shared regional or national domain and may include traffic from multiple locations.",
  unknown: "The SEO scope has not yet been confirmed.",
};

export const SEARCH_SCOPE_LABELS: Record<SearchScope, string> = {
  location: "Location",
  company: "Company",
  mixed: "Mixed",
  unknown: "Unknown",
};

export type SearchScopeInput = {
  /** Existing dual-scope row: company_domain | business_location */
  scope: SeoScope | null | undefined;
  analysisMode: AnalysisMode | null | undefined;
  analysisTarget?: string | null;
  locationPath?: string | null;
  companyScale: CompanyScale | null | undefined;
  /** Linked business count for the company (from companies.location_count or count). */
  locationCount?: number | null;
};

export type SearchScopeResult = {
  searchScope: SearchScope;
  needsManualReview: boolean;
  reason: string;
};

function isMultiFootprint(scale: CompanyScale | null | undefined): boolean {
  return (
    scale === "multi_location" ||
    scale === "regional" ||
    scale === "national"
  );
}

/**
 * Classify an Ahrefs snapshot's search_scope.
 * Ownership alone does not decide scope; scale + analysis target shape do.
 */
export function determineSearchScope(
  input: SearchScopeInput,
): SearchScopeResult {
  const mode = input.analysisMode ?? null;
  const scope = input.scope ?? null;
  const scale = input.companyScale ?? "unknown";
  const locationCount = input.locationCount ?? null;
  const hasLocationPath = Boolean(
    input.locationPath && input.locationPath.trim().length > 1,
  );

  const isLocationTarget =
    scope === "business_location" ||
    mode === "prefix" ||
    mode === "subdomain" ||
    (mode === "exact_url" && hasLocationPath);

  // B / C — location-specific path or subdomain
  if (isLocationTarget) {
    return {
      searchScope: "location",
      needsManualReview: false,
      reason: "location_specific_target",
    };
  }

  // Domain / company-domain row
  if (mode === "domain" || scope === "company_domain" || mode === null) {
    // A — single-location company root domain
    if (scale === "single_location") {
      return {
        searchScope: "company",
        needsManualReview: false,
        reason: "single_location_company_domain",
      };
    }

    // D — multi-location / regional / national root domain only (or parent domain)
    if (isMultiFootprint(scale)) {
      return {
        searchScope: "mixed",
        needsManualReview: false,
        reason: "shared_company_domain_multi_footprint",
      };
    }

    // Unknown scale — use linked location count when available
    if (locationCount != null && locationCount >= 2) {
      return {
        searchScope: "mixed",
        needsManualReview: true,
        reason: "multiple_linked_locations_unknown_scale",
      };
    }

    if (locationCount === 1) {
      return {
        searchScope: "unknown",
        needsManualReview: true,
        reason: "single_linked_location_unknown_scale",
      };
    }

    // E
    return {
      searchScope: "unknown",
      needsManualReview: true,
      reason: "insufficient_classification_context",
    };
  }

  return {
    searchScope: "unknown",
    needsManualReview: true,
    reason: "unrecognized_analysis_shape",
  };
}

export function parseSearchScope(
  value: string | null | undefined,
): SearchScope {
  if (
    value === "location" ||
    value === "company" ||
    value === "mixed" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}
