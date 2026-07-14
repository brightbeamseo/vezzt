import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import type { QualificationStatus } from "@/lib/qualification";
import type {
  DashboardBusiness,
  DashboardBusinessDetail,
  DashboardSummary,
  ReviewSnapshotSummary,
} from "@/lib/dashboard-types";
import { SCORE_MODEL_STATUS } from "@/lib/dashboard-types";

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

type SnapshotRow = {
  id: string;
  snapshot_date: string;
  review_count: number | null;
  average_rating: number | string | null;
  source: string;
};

type MetricsRow = {
  estimated_value_low: number | string | null;
  estimated_value_mid: number | string | null;
  estimated_value_high: number | string | null;
  confidence_score: number | string | null;
  acquisition_score: number | string | null;
  review_velocity_monthly: number | string | null;
  estimated_annual_revenue: number | string | null;
  updated_at?: string | null;
};

type EnrichmentRow = {
  employee_count_estimate: number | null;
  founded_year: number | null;
  years_in_business: number | null;
  linkedin_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  entity_name: string | null;
  entity_status: string | null;
  owner_names: string[] | null;
  ads_detected: boolean | null;
  seo_traffic_estimate: number | null;
  notes: string | null;
};

type BusinessQueryRow = {
  id: string;
  name: string;
  primary_category: string | null;
  secondary_categories: string[] | null;
  website_url: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  google_maps_url: string | null;
  is_active: boolean;
  is_qualified: boolean;
  qualification_status: string;
  qualification_reason: string | null;
  qualification_confidence: number | string | null;
  target_sector: string | null;
  review_threshold_met: boolean;
  company_id?: string | null;
  analysis_target?: string | null;
  analysis_mode?: string | null;
  companies?:
    | {
        id: string;
        company_name: string;
        company_type: string;
        root_domain: string | null;
        website: string | null;
      }
    | {
        id: string;
        company_name: string;
        company_type: string;
        root_domain: string | null;
        website: string | null;
      }[]
    | null;
  business_metrics: MetricsRow[] | MetricsRow | null;
  business_enrichment?: EnrichmentRow[] | EnrichmentRow | null;
  review_snapshots: SnapshotRow[] | null;
};

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function pickLatestSnapshot(
  snapshots: SnapshotRow[],
): SnapshotRow | null {
  if (!snapshots.length) return null;
  return [...snapshots].sort((a, b) =>
    a.snapshot_date < b.snapshot_date ? 1 : a.snapshot_date > b.snapshot_date ? -1 : 0,
  )[0];
}

function mapSnapshot(row: SnapshotRow): ReviewSnapshotSummary {
  return {
    id: row.id,
    snapshotDate: row.snapshot_date,
    reviewCount: row.review_count,
    averageRating: toNumber(row.average_rating),
    source: row.source,
  };
}

function mapBusinessRow(row: BusinessQueryRow): DashboardBusiness {
  const metrics = asArray(row.business_metrics)[0] ?? null;
  const latest = pickLatestSnapshot(asArray(row.review_snapshots));
  const lat = toNumber(row.latitude);
  const lng = toNumber(row.longitude);

  return {
    id: row.id,
    name: row.name,
    primaryCategory: row.primary_category,
    secondaryCategories: row.secondary_categories,
    websiteUrl: row.website_url,
    phone: row.phone,
    address: row.address,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code,
    latitude: lat,
    longitude: lng,
    googleMapsUrl: row.google_maps_url,
    isActive: row.is_active,
    isQualified: row.is_qualified,
    qualificationStatus: row.qualification_status as QualificationStatus,
    qualificationReason: row.qualification_reason,
    qualificationConfidence: toNumber(row.qualification_confidence),
    targetSector: row.target_sector,
    reviewThresholdMet: row.review_threshold_met,
    reviewCount: latest?.review_count ?? null,
    averageRating: latest ? toNumber(latest.average_rating) : null,
    latestSnapshotDate: latest?.snapshot_date ?? null,
    vestimateLow: metrics ? toNumber(metrics.estimated_value_low) : null,
    vestimateMid: metrics ? toNumber(metrics.estimated_value_mid) : null,
    vestimateHigh: metrics ? toNumber(metrics.estimated_value_high) : null,
    confidenceScore: metrics ? toNumber(metrics.confidence_score) : null,
    acquisitionScore: metrics ? toNumber(metrics.acquisition_score) : null,
    reviewVelocityMonthly: metrics
      ? toNumber(metrics.review_velocity_monthly)
      : null,
    estimatedAnnualRevenue: metrics
      ? toNumber(metrics.estimated_annual_revenue)
      : null,
    growthScore: null,
    marketStrength: null,
    brandStrength: null,
    modelVersion: null,
    hasCoordinates: lat !== null && lng !== null,
  };
}

const LIST_SELECT = `
  id,
  name,
  primary_category,
  secondary_categories,
  website_url,
  phone,
  address,
  city,
  state,
  postal_code,
  latitude,
  longitude,
  google_maps_url,
  is_active,
  is_qualified,
  qualification_status,
  qualification_reason,
  qualification_confidence,
  target_sector,
  review_threshold_met,
  business_metrics (
    estimated_value_low,
    estimated_value_mid,
    estimated_value_high,
    confidence_score,
    acquisition_score,
    review_velocity_monthly,
    estimated_annual_revenue
  ),
  review_snapshots (
    id,
    snapshot_date,
    review_count,
    average_rating,
    source
  )
`;

export async function getDashboardBusinesses(): Promise<DashboardBusiness[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("businesses")
    .select(LIST_SELECT)
    .order("name");

  if (error) {
    throw new Error(`Failed to load dashboard businesses: ${error.message}`);
  }

  return ((data ?? []) as BusinessQueryRow[]).map(mapBusinessRow);
}

export function buildDashboardSummary(
  businesses: DashboardBusiness[],
): DashboardSummary {
  const withReviews = businesses.filter((b) => b.reviewCount !== null);
  const reviewSum = withReviews.reduce((acc, b) => acc + (b.reviewCount ?? 0), 0);
  const withRatings = businesses.filter((b) => b.averageRating !== null);
  const ratingSum = withRatings.reduce(
    (acc, b) => acc + (b.averageRating ?? 0),
    0,
  );
  const highest = withReviews.reduce<number | null>((max, b) => {
    const n = b.reviewCount ?? 0;
    return max === null || n > max ? n : max;
  }, null);

  return {
    totalBusinesses: businesses.length,
    withReviewData: withReviews.length,
    averageReviewCount:
      withReviews.length > 0 ? reviewSum / withReviews.length : null,
    averageRating:
      withRatings.length > 0 ? ratingSum / withRatings.length : null,
    highestReviewCount: highest,
    qualifiedCount: businesses.filter((b) => b.qualificationStatus === "qualified")
      .length,
    belowThresholdCount: businesses.filter(
      (b) => b.qualificationStatus === "below_threshold",
    ).length,
    missingCoordinatesCount: businesses.filter((b) => !b.hasCoordinates).length,
  };
}

export async function getDashboardBusinessById(
  id: string,
): Promise<DashboardBusinessDetail | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("businesses")
    .select(
      `
      id,
      name,
      primary_category,
      secondary_categories,
      website_url,
      phone,
      address,
      city,
      state,
      postal_code,
      latitude,
      longitude,
      google_maps_url,
      is_active,
      is_qualified,
      qualification_status,
      qualification_reason,
      qualification_confidence,
      target_sector,
      review_threshold_met,
      company_id,
      analysis_target,
      analysis_mode,
      companies (
        id,
        company_name,
        company_type,
        root_domain,
        website
      ),
      business_metrics (
        estimated_value_low,
        estimated_value_mid,
        estimated_value_high,
        confidence_score,
        acquisition_score,
        review_velocity_monthly,
        estimated_annual_revenue,
        updated_at
      ),
      business_enrichment (
        employee_count_estimate,
        founded_year,
        years_in_business,
        linkedin_url,
        facebook_url,
        instagram_url,
        entity_name,
        entity_status,
        owner_names,
        ads_detected,
        seo_traffic_estimate,
        notes
      ),
      review_snapshots (
        id,
        snapshot_date,
        review_count,
        average_rating,
        source
      )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load business ${id}: ${error.message}`);
  }
  if (!data) return null;

  const row = data as BusinessQueryRow;
  const base = mapBusinessRow(row);
  const enrichment = asArray(row.business_enrichment)[0] ?? null;
  const metrics = asArray(row.business_metrics)[0] ?? null;
  const snapshots = asArray(row.review_snapshots)
    .map(mapSnapshot)
    .sort((a, b) =>
      a.snapshotDate < b.snapshotDate
        ? -1
        : a.snapshotDate > b.snapshotDate
          ? 1
          : 0,
    );

  const { data: mapRankRows, error: mapRankError } = await supabase
    .from("map_rank_snapshots")
    .select(
      `
      id,
      provider_scan_id,
      search_term,
      scanned_at,
      grid_size,
      spacing_value,
      spacing_unit,
      average_grid_rank,
      average_total_grid_rank,
      share_of_local_voice,
      found_in_top_3_count,
      found_in_top_10_count,
      total_grid_points,
      ranks,
      status,
      raw_response
    `,
    )
    .eq("business_id", id)
    .order("scanned_at", { ascending: false, nullsFirst: false })
    .limit(1);

  if (mapRankError) {
    throw new Error(
      `Failed to load map rank for ${id}: ${mapRankError.message}`,
    );
  }

  const mapRankRow = (mapRankRows ?? [])[0] as
    | {
        id: string;
        provider_scan_id: string;
        search_term: string;
        scanned_at: string | null;
        grid_size: number | null;
        spacing_value: number | string | null;
        spacing_unit: string | null;
        average_grid_rank: number | string | null;
        average_total_grid_rank: number | string | null;
        share_of_local_voice: number | string | null;
        found_in_top_3_count: number | null;
        found_in_top_10_count: number | null;
        total_grid_points: number | null;
        ranks: unknown;
        status: string | null;
        raw_response: { error?: string } | null;
      }
    | undefined;

  const { data: seoRows, error: seoError } = await supabase
    .from("seo_snapshots")
    .select(
      `
      id,
      provider,
      domain,
      scope,
      analysis_target,
      analysis_mode,
      parent_domain,
      location_path,
      snapshot_date,
      domain_rating,
      referring_domains,
      backlinks,
      organic_traffic,
      organic_keywords,
      organic_keywords_top3,
      traffic_value,
      created_at
    `,
    )
    .eq("business_id", id)
    .order("snapshot_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (seoError) {
    throw new Error(`Failed to load SEO snapshot for ${id}: ${seoError.message}`);
  }

  type SeoDb = {
    id: string;
    provider: string;
    domain: string;
    scope: string;
    analysis_target: string;
    analysis_mode: string;
    parent_domain: string | null;
    location_path: string | null;
    snapshot_date: string;
    domain_rating: number | string | null;
    referring_domains: number | null;
    backlinks: number | null;
    organic_traffic: number | null;
    organic_keywords: number | null;
    organic_keywords_top3: number | null;
    traffic_value: number | string | null;
  };

  const mapSeo = (seoRow: SeoDb) => ({
    id: seoRow.id,
    provider: seoRow.provider,
    domain: seoRow.domain,
    scope: seoRow.scope,
    analysisTarget: seoRow.analysis_target,
    analysisMode: seoRow.analysis_mode,
    parentDomain: seoRow.parent_domain,
    locationPath: seoRow.location_path,
    snapshotDate: seoRow.snapshot_date,
    domainRating: toNumber(seoRow.domain_rating),
    referringDomains: seoRow.referring_domains,
    backlinks: seoRow.backlinks,
    organicTraffic: seoRow.organic_traffic,
    organicKeywords: seoRow.organic_keywords,
    organicKeywordsTop3: seoRow.organic_keywords_top3,
    trafficValue: toNumber(seoRow.traffic_value),
  });

  const allSeo = (seoRows ?? []) as SeoDb[];
  const seoParentRow =
    allSeo.find((r) => r.scope === "company_domain") ?? null;
  const seoLocalRow =
    allSeo.find((r) => r.scope === "business_location") ?? null;
  // Legacy / single-scope display fallback
  const seoRow = seoParentRow ?? seoLocalRow ?? allSeo[0] ?? undefined;

  const companyRow = asArray(row.companies)[0] ?? null;
  const companyId = row.company_id ?? companyRow?.id ?? null;

  let siblingLocations: {
    id: string;
    name: string;
    city: string | null;
    websiteUrl: string | null;
  }[] = [];

  if (companyId) {
    const { data: siblings, error: siblingsError } = await supabase
      .from("businesses")
      .select("id, name, city, website_url")
      .eq("company_id", companyId)
      .neq("id", id)
      .order("name", { ascending: true });

    if (siblingsError) {
      throw new Error(
        `Failed to load sibling locations for ${id}: ${siblingsError.message}`,
      );
    }

    siblingLocations = (siblings ?? []).map((s) => ({
      id: s.id as string,
      name: s.name as string,
      city: (s.city as string | null) ?? null,
      websiteUrl: (s.website_url as string | null) ?? null,
    }));
  }

  return {
    ...base,
    snapshots,
    enrichment: enrichment
      ? {
          employeeCountEstimate: enrichment.employee_count_estimate,
          foundedYear: enrichment.founded_year,
          yearsInBusiness: enrichment.years_in_business,
          linkedinUrl: enrichment.linkedin_url,
          facebookUrl: enrichment.facebook_url,
          instagramUrl: enrichment.instagram_url,
          entityName: enrichment.entity_name,
          entityStatus: enrichment.entity_status,
          ownerNames: enrichment.owner_names,
          adsDetected: enrichment.ads_detected,
          seoTrafficEstimate: enrichment.seo_traffic_estimate,
          notes: enrichment.notes,
        }
      : null,
    metricsUpdatedAt: metrics?.updated_at ?? null,
    modelVersion: SCORE_MODEL_STATUS,
    mapRank: mapRankRow
      ? {
          id: mapRankRow.id,
          providerScanId: mapRankRow.provider_scan_id,
          searchTerm: mapRankRow.search_term,
          scannedAt: mapRankRow.scanned_at,
          gridSize: mapRankRow.grid_size,
          spacingValue: toNumber(mapRankRow.spacing_value),
          spacingUnit: mapRankRow.spacing_unit,
          averageGridRank: toNumber(mapRankRow.average_grid_rank),
          averageTotalGridRank: toNumber(mapRankRow.average_total_grid_rank),
          shareOfLocalVoice: toNumber(mapRankRow.share_of_local_voice),
          foundInTop3Count: mapRankRow.found_in_top_3_count,
          foundInTop10Count: mapRankRow.found_in_top_10_count,
          totalGridPoints: mapRankRow.total_grid_points,
          ranks: mapRankRow.ranks,
          status: mapRankRow.status,
          errorMessage:
            mapRankRow.status === "failed"
              ? (mapRankRow.raw_response?.error ?? "Scan failed")
              : null,
        }
      : null,
    seo: seoRow ? mapSeo(seoRow) : null,
    seoParent: seoParentRow ? mapSeo(seoParentRow) : null,
    seoLocal: seoLocalRow ? mapSeo(seoLocalRow) : null,
    company: companyRow
      ? {
          id: companyRow.id,
          companyName: companyRow.company_name,
          companyType: companyRow.company_type,
          rootDomain: companyRow.root_domain,
          website: companyRow.website,
        }
      : null,
    analysisTarget: row.analysis_target ?? null,
    analysisMode: row.analysis_mode ?? null,
    siblingLocations,
  };
}

export { SCORE_MODEL_STATUS };

export type BoiseRoofingComparisonRow = {
  id: string;
  name: string;
  city: string | null;
  reviewCount: number | null;
  averageRating: number | null;
  domainRating: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  referringDomains: number | null;
  shareOfLocalVoice: number | null;
  averageGridRank: number | null;
  foundInTop3Count: number | null;
  totalGridPoints: number | null;
  mapRankStatus: string | null;
  dataCompleteness: number;
  missingFields: string[];
};

/**
 * Qualified Boise Metro roofers with 100+ reviews — comparison cohort.
 */
export async function getBoiseRoofingComparison(): Promise<
  BoiseRoofingComparisonRow[]
> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("businesses")
    .select(
      `
      id,
      name,
      city,
      qualification_status,
      primary_category,
      review_snapshots (
        snapshot_date,
        review_count,
        average_rating
      )
    `,
    )
    .eq("qualification_status", "qualified")
    .eq("primary_category", "Roofing contractor");

  if (error) {
    throw new Error(`Failed to load Boise comparison businesses: ${error.message}`);
  }

  const { MARKETS, normalizeCityName } = await import("@/lib/markets");
  const allowed = new Set(
    MARKETS["boise-metro"].cities.map((c) => normalizeCityName(c)),
  );

  const base = (data ?? [])
    .map((row) => {
      const snapshots = asArray(
        row.review_snapshots as
          | {
              snapshot_date: string;
              review_count: number | null;
              average_rating: number | string | null;
            }[]
          | null,
      );
      const latest = pickLatestSnapshot(
        snapshots.map((s) => ({
          id: s.snapshot_date,
          snapshot_date: s.snapshot_date,
          review_count: s.review_count,
          average_rating: s.average_rating,
          source: "google_apify",
        })),
      );
      return {
        id: row.id as string,
        name: row.name as string,
        city: (row.city as string | null) ?? null,
        reviewCount: latest?.review_count ?? null,
        averageRating: latest ? toNumber(latest.average_rating) : null,
      };
    })
    .filter(
      (b) =>
        b.city &&
        allowed.has(normalizeCityName(b.city)) &&
        (b.reviewCount ?? 0) >= 100,
    );

  const rows: BoiseRoofingComparisonRow[] = [];

  for (const business of base) {
    const [{ data: mapRows }, { data: seoRows }] = await Promise.all([
      supabase
        .from("map_rank_snapshots")
        .select(
          `
          status,
          share_of_local_voice,
          average_grid_rank,
          found_in_top_3_count,
          total_grid_points,
          scanned_at,
          created_at
        `,
        )
        .eq("business_id", business.id)
        .order("scanned_at", { ascending: false, nullsFirst: false })
        .limit(1),
      supabase
        .from("seo_snapshots")
        .select(
          `
          scope,
          domain_rating,
          organic_traffic,
          organic_keywords,
          referring_domains,
          snapshot_date,
          created_at
        `,
        )
        .eq("business_id", business.id)
        .order("snapshot_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(5),
    ]);

    const mapRank = (mapRows ?? [])[0] as
      | {
          status: string | null;
          share_of_local_voice: number | string | null;
          average_grid_rank: number | string | null;
          found_in_top_3_count: number | null;
          total_grid_points: number | null;
        }
      | undefined;

    const seoCandidates = (seoRows ?? []) as {
      scope?: string;
      domain_rating: number | string | null;
      organic_traffic: number | null;
      organic_keywords: number | null;
      referring_domains: number | null;
    }[];
    const seo =
      seoCandidates.find((r) => r.scope === "company_domain") ??
      seoCandidates[0];

    const fields: { key: string; present: boolean }[] = [
      { key: "reviews", present: business.reviewCount !== null },
      { key: "rating", present: business.averageRating !== null },
      { key: "domain_rating", present: seo?.domain_rating != null },
      { key: "organic_traffic", present: seo?.organic_traffic != null },
      { key: "organic_keywords", present: seo?.organic_keywords != null },
      { key: "referring_domains", present: seo?.referring_domains != null },
      {
        key: "solv",
        present:
          mapRank?.status === "finished" && mapRank.share_of_local_voice != null,
      },
      {
        key: "agr",
        present:
          mapRank?.status === "finished" && mapRank.average_grid_rank != null,
      },
      {
        key: "top3",
        present:
          mapRank?.status === "finished" && mapRank.found_in_top_3_count != null,
      },
    ];

    const presentCount = fields.filter((f) => f.present).length;
    const missingFields = fields.filter((f) => !f.present).map((f) => f.key);

    rows.push({
      id: business.id,
      name: business.name,
      city: business.city,
      reviewCount: business.reviewCount,
      averageRating: business.averageRating,
      domainRating: seo ? toNumber(seo.domain_rating) : null,
      organicTraffic: seo?.organic_traffic ?? null,
      organicKeywords: seo?.organic_keywords ?? null,
      referringDomains: seo?.referring_domains ?? null,
      shareOfLocalVoice: mapRank ? toNumber(mapRank.share_of_local_voice) : null,
      averageGridRank: mapRank ? toNumber(mapRank.average_grid_rank) : null,
      foundInTop3Count: mapRank?.found_in_top_3_count ?? null,
      totalGridPoints: mapRank?.total_grid_points ?? null,
      mapRankStatus: mapRank?.status ?? null,
      dataCompleteness: Math.round((presentCount / fields.length) * 100),
      missingFields,
    });
  }

  return rows.sort((a, b) => {
    const ra = a.reviewCount ?? -1;
    const rb = b.reviewCount ?? -1;
    return rb - ra;
  });
}
