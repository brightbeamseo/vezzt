import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { percentileRank } from "@/lib/market-comparison-utils";
import type {
  MarketComparisonPayload,
  MarketComparisonRow,
} from "@/lib/market-comparison-types";

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

function usesParentAsLocal(scale: string | null, ownership: string | null): boolean {
  return scale === "single_location" && ownership === "independent";
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
  parent_domain_rating: number | string | null;
  parent_organic_traffic: number | null;
  parent_organic_keywords: number | null;
  parent_referring_domains: number | null;
  parent_backlinks: number | null;
  parent_traffic_value: number | string | null;
  local_seo_id: string | null;
  local_analysis_target: string | null;
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
};

function mapSignalRow(raw: SignalRow): Omit<MarketComparisonRow, "percentiles"> {
  const scale = raw.company_scale;
  const ownership = raw.ownership_model;
  const hasLocalSeo = Boolean(raw.local_seo_id);
  const localFromParent = !hasLocalSeo && usesParentAsLocal(scale, ownership);

  const localOrganicTraffic = hasLocalSeo
    ? raw.local_organic_traffic
    : localFromParent
      ? raw.parent_organic_traffic
      : null;
  const localOrganicKeywords = hasLocalSeo
    ? raw.local_organic_keywords
    : localFromParent
      ? raw.parent_organic_keywords
      : null;
  const localKeywordsTop3 = hasLocalSeo ? raw.local_organic_keywords_top3 : null;
  const localReferringDomains = hasLocalSeo
    ? raw.local_referring_domains
    : localFromParent
      ? raw.parent_referring_domains
      : null;
  const localBacklinks = hasLocalSeo
    ? raw.local_backlinks
    : localFromParent
      ? raw.parent_backlinks
      : null;
  const localTrafficValue = hasLocalSeo
    ? toNumber(raw.local_traffic_value)
    : localFromParent
      ? toNumber(raw.parent_traffic_value)
      : null;
  const localAnalysisTarget = hasLocalSeo
    ? raw.local_analysis_target
    : localFromParent
      ? raw.parent_analysis_target
      : null;

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

  const parentDr = toNumber(raw.parent_domain_rating);
  const hasAhrefs =
    localOrganicTraffic != null ||
    localOrganicKeywords != null ||
    parentDr != null ||
    raw.parent_organic_traffic != null;
  const hasGeogrid = Boolean(raw.map_rank_id);
  const reviewSnapshotCount = raw.review_snapshot_count ?? 0;

  const fields: { key: string; present: boolean }[] = [
    { key: "reviews", present: raw.review_count != null },
    { key: "rating", present: raw.average_rating != null },
    { key: "local_organic_traffic", present: localOrganicTraffic != null },
    { key: "local_organic_keywords", present: localOrganicKeywords != null },
    { key: "local_referring_domains", present: localReferringDomains != null },
    { key: "parent_domain_rating", present: parentDr != null },
    { key: "solv", present: solv != null },
    { key: "agr", present: agr != null },
    { key: "top3", present: top3Coverage != null },
  ];
  const presentCount = fields.filter((f) => f.present).length;
  const missingFields = fields.filter((f) => !f.present).map((f) => f.key);

  const ahrefsTarget =
    localAnalysisTarget ?? raw.parent_analysis_target ?? raw.parent_domain;

  return {
    businessId: raw.business_id,
    businessName: raw.business_name,
    city: raw.city,
    state: raw.state,
    websiteUrl: raw.website_url,
    googleMapsUrl: raw.google_maps_url,
    primaryCategory: raw.primary_category,
    targetSector: raw.target_sector,
    marketId: raw.market_id,
    qualificationStatus: raw.qualification_status,
    isQualified: raw.is_qualified,
    analysisTarget: raw.analysis_target,
    analysisMode: raw.analysis_mode,
    companyId: raw.company_id,
    companyName: raw.company_name,
    companyScale: scale,
    ownershipModel: ownership,
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
    localOrganicTraffic,
    localOrganicKeywords,
    localKeywordsTop3,
    localReferringDomains,
    localBacklinks,
    localTrafficValue,
    localAnalysisTarget,
    parentDomainRating: parentDr,
    parentOrganicTraffic: raw.parent_organic_traffic,
    parentOrganicKeywords: raw.parent_organic_keywords,
    parentReferringDomains: raw.parent_referring_domains,
    parentDomain: raw.parent_domain,
    parentAnalysisTarget: raw.parent_analysis_target,
    localAhrefsFromParent: localFromParent,
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
    hasAhrefs,
    hasGeogrid,
    hasMultipleReviewSnapshots: reviewSnapshotCount >= 2,
    ahrefsUrl: buildAhrefsUrl(ahrefsTarget),
    geogridUrl: `/businesses/${raw.business_id}`,
  };
}

/**
 * Load flattened current-state signals for a market + sector.
 * One DB query via business_current_signals (no N+1).
 */
export async function getMarketComparisonSignals(input: {
  marketId: string;
  sector: string;
}): Promise<MarketComparisonPayload> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("business_current_signals")
    .select("*")
    .eq("market_id", input.marketId)
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
  const trafficUniverse = mapped.map((r) => r.localOrganicTraffic);
  const solvUniverse = mapped.map((r) => r.shareOfLocalVoice);
  const rdUniverse = mapped.map((r) => r.localReferringDomains);

  const rows: MarketComparisonRow[] = mapped.map((row) => ({
    ...row,
    percentiles: {
      reviewCount: percentileRank(row.reviewCount, reviewUniverse),
      localOrganicTraffic: percentileRank(
        row.localOrganicTraffic,
        trafficUniverse,
      ),
      shareOfLocalVoice: percentileRank(row.shareOfLocalVoice, solvUniverse),
      localReferringDomains: percentileRank(
        row.localReferringDomains,
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
