import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { percentileRank } from "@/lib/market-comparison-utils";
import type {
  MarketComparisonPayload,
  MarketComparisonRow,
  ScopedMetric,
} from "@/lib/market-comparison-types";
import {
  parseSearchScope,
  type SearchScope,
} from "@/lib/search-scope";

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function daysBetween(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(db - da) / (24 * 60 * 60 * 1000);
}

function coverageRatio(
  found: number | null,
  total: number | null,
): number | null {
  if (found === null || total === null || total <= 0) return null;
  return found / total;
}

function buildAhrefsUrl(target: string | null | undefined): string | null {
  if (!target) return null;
  return `https://app.ahrefs.com/v2-site-explorer/overview?target=${encodeURIComponent(target)}`;
}

function scoped(
  value: number | null,
  searchScope: SearchScope,
): ScopedMetric {
  return { value, searchScope };
}

type SignalRow = {
  business_id: string;
  business_name: string;
  city: string | null;
  state: string | null;
  website_url: string | null;
  google_maps_url: string | null;
  primary_category: string | null;
  target_sector: string | null;
  qualification_status: string;
  is_qualified: boolean;
  market_id: string | null;
  market_slug: string | null;
  market_name: string | null;
  market_type: string | null;
  market_timezone: string | null;
  analysis_target: string | null;
  analysis_mode: string | null;
  company_id: string | null;
  company_name: string | null;
  company_scale: string | null;
  ownership_model: string | null;
  company_location_count: number | null;
  company_root_domain: string | null;
  classification_is_manual: boolean | null;
  review_snapshot_date: string | null;
  review_count: number | null;
  average_rating: number | string | null;
  prior_snapshot_date: string | null;
  prior_review_count: number | null;
  reviews_gained_since_prior: number | null;
  review_snapshot_count: number | null;
  estimated_monthly_review_velocity_metrics: number | string | null;
  parent_domain: string | null;
  parent_analysis_target: string | null;
  parent_analysis_mode: string | null;
  parent_search_scope: string | null;
  parent_domain_rating: number | string | null;
  parent_organic_traffic: number | null;
  parent_organic_keywords: number | null;
  parent_referring_domains: number | null;
  parent_backlinks: number | null;
  parent_traffic_value: number | string | null;
  local_seo_id: string | null;
  local_analysis_target: string | null;
  local_analysis_mode: string | null;
  local_search_scope: string | null;
  local_domain_rating: number | string | null;
  local_organic_traffic: number | null;
  local_organic_keywords: number | null;
  local_organic_keywords_top3: number | null;
  local_referring_domains: number | null;
  local_backlinks: number | null;
  local_traffic_value: number | string | null;
  map_rank_id: string | null;
  provider_scan_id: string | null;
  geogrid_scanned_at: string | null;
  share_of_local_voice: number | string | null;
  average_grid_rank: number | string | null;
  average_total_grid_rank: number | string | null;
  found_in_top_3_count: number | null;
  found_in_top_10_count: number | null;
  total_grid_points: number | null;
  latest_data_refresh_at: string | null;
  postal_code: string | null;
  zip_code_normalized: string | null;
  zip_population: number | null;
  zip_households: number | null;
  zip_housing_units: number | null;
  zip_owner_occupied_housing_units: number | null;
  zip_owner_occupied_rate: number | string | null;
  zip_median_household_income: number | string | null;
  zip_median_home_value: number | string | null;
  zip_median_year_structure_built: number | string | null;
  zip_dataset_year: number | null;
};

/**
 * Prefer Location-scope Ahrefs for primary columns.
 * Fall back to company_domain snapshot (Company or Mixed) with its badge.
 * Never treat Mixed as Location.
 */
function resolvePrimaryAhrefs(raw: SignalRow): {
  searchScope: SearchScope;
  analysisTarget: string | null;
  analysisMode: string | null;
  organicTraffic: ScopedMetric;
  organicKeywords: ScopedMetric;
  keywordsTop3: ScopedMetric;
  referringDomains: ScopedMetric;
  backlinks: ScopedMetric;
  trafficValue: ScopedMetric;
  domainRating: ScopedMetric;
  hasLocationSeo: boolean;
  mixedWithoutLocationWarning: boolean;
  parentOrganicTraffic: ScopedMetric | null;
  parentOrganicKeywords: ScopedMetric | null;
  parentReferringDomains: ScopedMetric | null;
  parentSearchScope: SearchScope | null;
} {
  const locationScope = parseSearchScope(raw.local_search_scope);
  const parentScope = parseSearchScope(raw.parent_search_scope);
  const hasLocationSeo = Boolean(raw.local_seo_id);

  if (hasLocationSeo) {
    const locScope: SearchScope =
      locationScope === "unknown" ? "location" : locationScope;
    return {
      searchScope: locScope,
      analysisTarget: raw.local_analysis_target,
      analysisMode: raw.local_analysis_mode,
      organicTraffic: scoped(raw.local_organic_traffic, locScope),
      organicKeywords: scoped(raw.local_organic_keywords, locScope),
      keywordsTop3: scoped(raw.local_organic_keywords_top3, locScope),
      referringDomains: scoped(raw.local_referring_domains, locScope),
      backlinks: scoped(raw.local_backlinks, locScope),
      trafficValue: scoped(toNumber(raw.local_traffic_value), locScope),
      // DR usually lives on the parent domain; badge that value Mixed/Company.
      domainRating: scoped(
        toNumber(raw.local_domain_rating) ?? toNumber(raw.parent_domain_rating),
        toNumber(raw.local_domain_rating) != null ? locScope : parentScope,
      ),
      hasLocationSeo: true,
      mixedWithoutLocationWarning: false,
      parentOrganicTraffic: scoped(raw.parent_organic_traffic, parentScope),
      parentOrganicKeywords: scoped(raw.parent_organic_keywords, parentScope),
      parentReferringDomains: scoped(raw.parent_referring_domains, parentScope),
      parentSearchScope: parentScope,
    };
  }

  // No location snapshot — use company-domain metrics with their classified scope.
  const companyScope = parentScope;
  const mixedWithoutLocationWarning = companyScope === "mixed";

  return {
    searchScope: companyScope,
    analysisTarget: raw.parent_analysis_target,
    analysisMode: raw.parent_analysis_mode,
    organicTraffic: scoped(raw.parent_organic_traffic, companyScope),
    organicKeywords: scoped(raw.parent_organic_keywords, companyScope),
    keywordsTop3: scoped(null, companyScope),
    referringDomains: scoped(raw.parent_referring_domains, companyScope),
    backlinks: scoped(raw.parent_backlinks, companyScope),
    trafficValue: scoped(toNumber(raw.parent_traffic_value), companyScope),
    domainRating: scoped(toNumber(raw.parent_domain_rating), companyScope),
    hasLocationSeo: false,
    mixedWithoutLocationWarning,
    parentOrganicTraffic: null,
    parentOrganicKeywords: null,
    parentReferringDomains: null,
    parentSearchScope: companyScope === "unknown" ? null : companyScope,
  };
}

function mapSignalRow(raw: SignalRow): Omit<MarketComparisonRow, "percentiles"> {
  const ahrefs = resolvePrimaryAhrefs(raw);

  const gained = raw.reviews_gained_since_prior;
  let weeklyReviewVelocity: number | null = null;
  if (
    gained !== null &&
    raw.review_snapshot_date &&
    raw.prior_snapshot_date
  ) {
    const days = daysBetween(raw.review_snapshot_date, raw.prior_snapshot_date);
    if (days > 0) weeklyReviewVelocity = (gained / days) * 7;
  }

  const metricsMonthly = toNumber(raw.estimated_monthly_review_velocity_metrics);
  const estimatedMonthlyReviewVelocity =
    metricsMonthly ??
    (weeklyReviewVelocity !== null ? weeklyReviewVelocity * (30 / 7) : null);

  const solv = toNumber(raw.share_of_local_voice);
  const agr = toNumber(raw.average_grid_rank);
  const atgr = toNumber(raw.average_total_grid_rank);
  const top3Coverage = coverageRatio(
    raw.found_in_top_3_count,
    raw.total_grid_points,
  );
  const top10Coverage = coverageRatio(
    raw.found_in_top_10_count,
    raw.total_grid_points,
  );

  const hasAhrefs =
    ahrefs.organicTraffic.value != null ||
    ahrefs.organicKeywords.value != null ||
    ahrefs.domainRating.value != null ||
    ahrefs.referringDomains.value != null;
  const hasGeogrid = Boolean(raw.map_rank_id);
  const reviewSnapshotCount = raw.review_snapshot_count ?? 0;

  const fields: { key: string; present: boolean }[] = [
    { key: "reviews", present: raw.review_count != null },
    { key: "rating", present: raw.average_rating != null },
    { key: "organic_traffic", present: ahrefs.organicTraffic.value != null },
    { key: "organic_keywords", present: ahrefs.organicKeywords.value != null },
    { key: "referring_domains", present: ahrefs.referringDomains.value != null },
    { key: "domain_rating", present: ahrefs.domainRating.value != null },
    { key: "solv", present: solv != null },
    { key: "agr", present: agr != null },
    { key: "top3", present: top3Coverage != null },
  ];
  const presentCount = fields.filter((f) => f.present).length;
  const missingFields = fields.filter((f) => !f.present).map((f) => f.key);

  return {
    businessId: raw.business_id,
    businessName: raw.business_name,
    city: raw.city,
    state: raw.state,
    websiteUrl: raw.website_url,
    googleMapsUrl: raw.google_maps_url,
    primaryCategory: raw.primary_category,
    targetSector: raw.target_sector,
    marketId: raw.market_slug ?? raw.market_id,
    marketUuid: raw.market_id,
    marketName: raw.market_name,
    qualificationStatus: raw.qualification_status,
    isQualified: raw.is_qualified,
    analysisTarget: ahrefs.analysisTarget,
    analysisMode: ahrefs.analysisMode,
    searchScope: ahrefs.searchScope,
    companyId: raw.company_id,
    companyName: raw.company_name,
    companyScale: raw.company_scale,
    ownershipModel: raw.ownership_model,
    companyLocationCount: raw.company_location_count,
    companyRootDomain: raw.company_root_domain,
    classificationIsManual: Boolean(raw.classification_is_manual),
    reviewCount: raw.review_count,
    rating: toNumber(raw.average_rating),
    reviewSnapshotDate: raw.review_snapshot_date,
    reviewsGainedSincePrior: gained,
    weeklyReviewVelocity,
    estimatedMonthlyReviewVelocity,
    reviewSnapshotCount,
    organicTraffic: ahrefs.organicTraffic,
    organicKeywords: ahrefs.organicKeywords,
    keywordsTop3: ahrefs.keywordsTop3,
    referringDomains: ahrefs.referringDomains,
    backlinks: ahrefs.backlinks,
    trafficValue: ahrefs.trafficValue,
    domainRating: ahrefs.domainRating,
    mixedWithoutLocationWarning: ahrefs.mixedWithoutLocationWarning,
    hasLocationSeo: ahrefs.hasLocationSeo,
    parentOrganicTraffic: ahrefs.parentOrganicTraffic,
    parentOrganicKeywords: ahrefs.parentOrganicKeywords,
    parentReferringDomains: ahrefs.parentReferringDomains,
    parentSearchScope: ahrefs.parentSearchScope,
    parentAnalysisTarget: raw.parent_analysis_target,
    parentDomain: raw.parent_domain,
    shareOfLocalVoice: solv,
    averageGridRank: agr,
    averageTotalGridRank: atgr,
    top3Coverage,
    top10Coverage,
    foundInTop3Count: raw.found_in_top_3_count,
    foundInTop10Count: raw.found_in_top_10_count,
    totalGridPoints: raw.total_grid_points,
    geogridScanDate: raw.geogrid_scanned_at,
    providerScanId: raw.provider_scan_id,
    dataCompleteness: Math.round((presentCount / fields.length) * 100),
    missingFields,
    latestDataRefresh: raw.latest_data_refresh_at,
    postalCode: raw.postal_code,
    zipCodeNormalized: raw.zip_code_normalized,
    zipPopulation: raw.zip_population,
    zipHouseholds: raw.zip_households,
    zipHousingUnits: raw.zip_housing_units,
    zipOwnerOccupiedHousingUnits: raw.zip_owner_occupied_housing_units,
    zipOwnerOccupiedRate: toNumber(raw.zip_owner_occupied_rate),
    zipMedianHouseholdIncome: toNumber(raw.zip_median_household_income),
    zipMedianHomeValue: toNumber(raw.zip_median_home_value),
    zipMedianYearStructureBuilt: toNumber(raw.zip_median_year_structure_built),
    zipDatasetYear: raw.zip_dataset_year,
    hasAhrefs,
    hasGeogrid,
    hasMultipleReviewSnapshots: reviewSnapshotCount >= 2,
    ahrefsUrl: buildAhrefsUrl(
      ahrefs.analysisTarget ?? raw.parent_analysis_target ?? raw.parent_domain,
    ),
    geogridUrl: `/businesses/${raw.business_id}`,
  };
}

export async function getMarketComparisonSignals(input: {
  marketId: string;
  sector: string;
}): Promise<MarketComparisonPayload> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("business_current_signals")
    .select("*")
    .eq("market_slug", input.marketId)
    .eq("target_sector", input.sector);

  if (error) {
    throw new Error(`Failed to load business_current_signals: ${error.message}`);
  }

  const rawRows = (data ?? []) as SignalRow[];
  const idCounts = new Map<string, number>();
  for (const row of rawRows) {
    idCounts.set(row.business_id, (idCounts.get(row.business_id) ?? 0) + 1);
  }
  const duplicateBusinessIds = [...idCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);

  const mapped = rawRows.map(mapSignalRow);

  const reviewUniverse = mapped.map((r) => r.reviewCount);
  const trafficUniverse = mapped.map((r) => r.organicTraffic.value);
  const solvUniverse = mapped.map((r) => r.shareOfLocalVoice);
  const rdUniverse = mapped.map((r) => r.referringDomains.value);

  const rows: MarketComparisonRow[] = mapped.map((row) => ({
    ...row,
    percentiles: {
      reviewCount: percentileRank(row.reviewCount, reviewUniverse),
      organicTraffic: percentileRank(row.organicTraffic.value, trafficUniverse),
      shareOfLocalVoice: percentileRank(row.shareOfLocalVoice, solvUniverse),
      referringDomains: percentileRank(
        row.referringDomains.value,
        rdUniverse,
      ),
    },
  }));

  rows.sort((a, b) => (b.reviewCount ?? -1) - (a.reviewCount ?? -1));

  const cities = [
    ...new Set(
      rows
        .map((r) => r.city)
        .filter((c): c is string => Boolean(c && c.trim())),
    ),
  ].sort((a, b) => a.localeCompare(b));

  return {
    marketId: input.marketId,
    sector: input.sector,
    rows,
    cities,
    duplicateBusinessIds,
  };
}

export {
  getNumericSortValue,
  summarizeMarketComparisonRows,
  median,
  percentileRank,
} from "@/lib/market-comparison-utils";
