import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export type ExpansionProject = {
  id: string;
  slug: string;
  name: string;
  industry: string;
  regionLabel: string;
  states: string[];
  status: string;
  notes: string | null;
};

export type ExpansionMarketListRow = {
  id: string;
  slug: string;
  displayName: string;
  state: string;
  status: string;
  geographyType: string;
  geographyMethodology: string | null;
  centerLat: number | null;
  centerLng: number | null;
  radiusMiles: number | null;
  sortOrder: number;
  ownerOccupiedHouseholds: number | null;
  singleFamilyDetachedHomes: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  housingGrowth: number | null;
  dedicatedCount: number | null;
  reviews100Plus: number | null;
  reviews250Plus: number | null;
  reviews500Plus: number | null;
  ownerHhPerDedicated: number | null;
  top5AvgReviews: number | null;
  finalOpportunityScore: number | null;
  demoDataQuality: string | null;
  competitionDataQuality: string | null;
};

export type ExpansionMarketDetail = ExpansionMarketListRow & {
  notes: string | null;
  population: number | null;
  households: number | null;
  homeownershipRate: number | null;
  housingUnits: number | null;
  householdGrowth: number | null;
  housingAgeDistribution: unknown;
  demoDatasetYear: number | null;
  demoBaselineYear: number | null;
  demoDataSource: string | null;
  demoCollectionDate: string | null;
  demoMethodologyVersion: string | null;
  demoQualityNotes: string | null;
  demoUpdatedAt: string | null;
  treeCanopy: number | null;
  rainfall: number | null;
  stormIndicators: unknown;
  envDatasetYear: number | null;
  envDataSource: string | null;
  envCollectionDate: string | null;
  envMethodologyVersion: string | null;
  envDataQuality: string | null;
  envQualityNotes: string | null;
  envUpdatedAt: string | null;
  totalDiscovered: number | null;
  roofingExteriorCount: number | null;
  cleaningRepairCount: number | null;
  reviews50Plus: number | null;
  reviews1000Plus: number | null;
  medianReviews: number | null;
  top3AvgReviews: number | null;
  competitorsPerOwnerHh: number | null;
  competitionComputedAt: string | null;
  competitionMethodologyVersion: string | null;
  competitionDataSource: string | null;
  competitionQualityNotes: string | null;
  marketPotentialScore: number | null;
  competitionScore: number | null;
  mapsOpportunityScore: number | null;
  demographicScore: number | null;
  demandScore: number | null;
  scoreAnalystNotes: string | null;
  scoreRisks: string | null;
  scoreAttractiveReasons: string | null;
  scoreStatus: string | null;
  scoreModelVersion: string | null;
  scoreComputedAt: string | null;
  zipCodes: string[];
  digitalObservations: Array<{
    id: string;
    channel: string;
    observation: string;
    observedAt: string;
    observer: string | null;
    sourceUrl: string | null;
    notes: string | null;
  }>;
  competitors: Array<{
    placeId: string;
    businessName: string | null;
    address: string | null;
    rating: number | null;
    reviewsCount: number | null;
    categoryName: string | null;
    classification: string | null;
    isPrimaryCompetitor: boolean | null;
    inRadius: boolean | null;
    distanceMiles: number | null;
  }>;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getExpansionProjectBySlug(
  slug: string,
): Promise<ExpansionProject | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data, error } = await supabase
    .from("expansion_projects")
    .select(
      "id, slug, name, industry, region_label, states, status, notes",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    industry: data.industry,
    regionLabel: data.region_label,
    states: data.states ?? [],
    status: data.status,
    notes: data.notes,
  };
}

export async function getExpansionMarketList(
  projectSlug: string,
): Promise<{ project: ExpansionProject; markets: ExpansionMarketListRow[] }> {
  const project = await getExpansionProjectBySlug(projectSlug);
  if (!project) {
    throw new Error(`Expansion project not found: ${projectSlug}`);
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: markets, error: marketsError } = await supabase
    .from("expansion_markets")
    .select(
      `
      id,
      slug,
      display_name,
      state,
      status,
      geography_type,
      geography_methodology,
      center_lat,
      center_lng,
      radius_miles,
      sort_order,
      expansion_market_demographics (
        owner_occupied_households,
        single_family_detached_homes,
        median_household_income,
        median_home_value,
        housing_growth,
        data_quality
      ),
      expansion_competition_metrics (
        industry,
        dedicated_count,
        reviews_100_plus,
        reviews_250_plus,
        reviews_500_plus,
        owner_hh_per_dedicated,
        top5_avg_reviews,
        data_quality
      ),
      expansion_scores (
        model_version,
        final_opportunity_score
      )
    `,
    )
    .eq("project_id", project.id)
    .order("sort_order", { ascending: true });

  if (marketsError) throw new Error(marketsError.message);

  const rows: ExpansionMarketListRow[] = (markets ?? []).map((m) => {
    const demoRaw = m.expansion_market_demographics;
    const demo = Array.isArray(demoRaw) ? demoRaw[0] : demoRaw;
    const metricsList = Array.isArray(m.expansion_competition_metrics)
      ? m.expansion_competition_metrics
      : m.expansion_competition_metrics
        ? [m.expansion_competition_metrics]
        : [];
    const metrics =
      metricsList.find((x) => x.industry === project.industry) ??
      metricsList[0] ??
      null;
    const scores = Array.isArray(m.expansion_scores)
      ? m.expansion_scores
      : m.expansion_scores
        ? [m.expansion_scores]
        : [];
    const score = scores[0] ?? null;

    return {
      id: m.id,
      slug: m.slug,
      displayName: m.display_name,
      state: m.state,
      status: m.status,
      geographyType: m.geography_type,
      geographyMethodology: m.geography_methodology,
      centerLat: toNumber(m.center_lat),
      centerLng: toNumber(m.center_lng),
      radiusMiles: toNumber(m.radius_miles),
      sortOrder: m.sort_order ?? 0,
      ownerOccupiedHouseholds: toNumber(demo?.owner_occupied_households),
      singleFamilyDetachedHomes: toNumber(demo?.single_family_detached_homes),
      medianHouseholdIncome: toNumber(demo?.median_household_income),
      medianHomeValue: toNumber(demo?.median_home_value),
      housingGrowth: toNumber(demo?.housing_growth),
      dedicatedCount: toNumber(metrics?.dedicated_count),
      reviews100Plus: toNumber(metrics?.reviews_100_plus),
      reviews250Plus: toNumber(metrics?.reviews_250_plus),
      reviews500Plus: toNumber(metrics?.reviews_500_plus),
      ownerHhPerDedicated: toNumber(metrics?.owner_hh_per_dedicated),
      top5AvgReviews: toNumber(metrics?.top5_avg_reviews),
      finalOpportunityScore: toNumber(score?.final_opportunity_score),
      demoDataQuality: demo?.data_quality ?? null,
      competitionDataQuality: metrics?.data_quality ?? null,
    };
  });

  return { project, markets: rows };
}

export function summarizeExpansionMarkets(markets: ExpansionMarketListRow[]) {
  const candidateCount = markets.length;
  const ownerHhValues = markets
    .map((m) => m.ownerOccupiedHouseholds)
    .filter((n): n is number => n != null);
  const dedicatedValues = markets
    .map((m) => m.dedicatedCount)
    .filter((n): n is number => n != null);
  const hhPerValues = markets
    .map((m) => m.ownerHhPerDedicated)
    .filter((n): n is number => n != null);

  return {
    candidateMarkets: candidateCount,
    totalOwnerHouseholds:
      ownerHhValues.length > 0
        ? ownerHhValues.reduce((a, b) => a + b, 0)
        : null,
    dedicatedGutterCompetitors:
      dedicatedValues.length > 0
        ? dedicatedValues.reduce((a, b) => a + b, 0)
        : null,
    averageHhPerCompetitor:
      hhPerValues.length > 0
        ? hhPerValues.reduce((a, b) => a + b, 0) / hhPerValues.length
        : null,
  };
}

export async function getExpansionMarketDetail(
  projectSlug: string,
  marketSlug: string,
): Promise<{ project: ExpansionProject; market: ExpansionMarketDetail } | null> {
  const project = await getExpansionProjectBySlug(projectSlug);
  if (!project) return null;

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data: m, error } = await supabase
    .from("expansion_markets")
    .select(
      `
      id,
      slug,
      display_name,
      state,
      status,
      geography_type,
      geography_methodology,
      center_lat,
      center_lng,
      radius_miles,
      sort_order,
      notes,
      expansion_market_demographics (*),
      expansion_market_environment (*),
      expansion_competition_metrics (*),
      expansion_scores (*),
      expansion_market_zips (zip_code),
      expansion_digital_observations (
        id, channel, observation, observed_at, observer, source_url, notes
      ),
      expansion_market_competitors (
        in_radius,
        distance_miles,
        place_id,
        expansion_competitors (
          place_id,
          business_name,
          address,
          rating,
          reviews_count,
          category_name
        )
      )
    `,
    )
    .eq("project_id", project.id)
    .eq("slug", marketSlug)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!m) return null;

  const demoRaw = m.expansion_market_demographics;
  const demo = Array.isArray(demoRaw) ? demoRaw[0] : demoRaw;
  const envRaw = m.expansion_market_environment;
  const env = Array.isArray(envRaw) ? envRaw[0] : envRaw;
  const metricsList = Array.isArray(m.expansion_competition_metrics)
    ? m.expansion_competition_metrics
    : m.expansion_competition_metrics
      ? [m.expansion_competition_metrics]
      : [];
  const metrics =
    metricsList.find((x) => x.industry === project.industry) ??
    metricsList[0] ??
    null;
  const scores = Array.isArray(m.expansion_scores)
    ? m.expansion_scores
    : m.expansion_scores
      ? [m.expansion_scores]
      : [];
  const score = scores[0] ?? null;

  const links = Array.isArray(m.expansion_market_competitors)
    ? m.expansion_market_competitors
    : [];
  const placeIds = links
    .map((l) => l.place_id)
    .filter((id): id is string => !!id);

  let classifications: Record<
    string,
    { classification: string; is_primary_competitor: boolean }
  > = {};
  if (placeIds.length > 0) {
    const { data: classRows } = await supabase
      .from("expansion_competitor_classifications")
      .select("place_id, classification, is_primary_competitor")
      .eq("industry", project.industry)
      .in("place_id", placeIds);
    for (const row of classRows ?? []) {
      classifications[row.place_id] = {
        classification: row.classification,
        is_primary_competitor: row.is_primary_competitor,
      };
    }
  }

  const competitors = links
    .map((link) => {
      const cRaw = link.expansion_competitors;
      const c = Array.isArray(cRaw) ? cRaw[0] : cRaw;
      if (!c) return null;
      const cls = classifications[c.place_id];
      return {
        placeId: c.place_id,
        businessName: c.business_name,
        address: c.address,
        rating: toNumber(c.rating),
        reviewsCount: toNumber(c.reviews_count),
        categoryName: c.category_name,
        classification: cls?.classification ?? null,
        isPrimaryCompetitor: cls?.is_primary_competitor ?? null,
        inRadius: link.in_radius ?? null,
        distanceMiles: toNumber(link.distance_miles),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null)
    .sort((a, b) => (b.reviewsCount ?? -1) - (a.reviewsCount ?? -1));

  const digitalRaw = Array.isArray(m.expansion_digital_observations)
    ? m.expansion_digital_observations
    : [];
  const digitalObservations = digitalRaw.map((d) => ({
    id: d.id,
    channel: d.channel,
    observation: d.observation,
    observedAt: d.observed_at,
    observer: d.observer,
    sourceUrl: d.source_url,
    notes: d.notes,
  }));

  const zips = Array.isArray(m.expansion_market_zips)
    ? m.expansion_market_zips.map((z) => z.zip_code).sort()
    : [];

  const market: ExpansionMarketDetail = {
    id: m.id,
    slug: m.slug,
    displayName: m.display_name,
    state: m.state,
    status: m.status,
    geographyType: m.geography_type,
    geographyMethodology: m.geography_methodology,
    centerLat: toNumber(m.center_lat),
    centerLng: toNumber(m.center_lng),
    radiusMiles: toNumber(m.radius_miles),
    sortOrder: m.sort_order ?? 0,
    notes: m.notes,
    ownerOccupiedHouseholds: toNumber(demo?.owner_occupied_households),
    singleFamilyDetachedHomes: toNumber(demo?.single_family_detached_homes),
    medianHouseholdIncome: toNumber(demo?.median_household_income),
    medianHomeValue: toNumber(demo?.median_home_value),
    housingGrowth: toNumber(demo?.housing_growth),
    dedicatedCount: toNumber(metrics?.dedicated_count),
    reviews100Plus: toNumber(metrics?.reviews_100_plus),
    reviews250Plus: toNumber(metrics?.reviews_250_plus),
    reviews500Plus: toNumber(metrics?.reviews_500_plus),
    ownerHhPerDedicated: toNumber(metrics?.owner_hh_per_dedicated),
    top5AvgReviews: toNumber(metrics?.top5_avg_reviews),
    finalOpportunityScore: toNumber(score?.final_opportunity_score),
    demoDataQuality: demo?.data_quality ?? null,
    competitionDataQuality: metrics?.data_quality ?? null,
    population: toNumber(demo?.population),
    households: toNumber(demo?.households),
    homeownershipRate: toNumber(demo?.homeownership_rate),
    housingUnits: toNumber(demo?.housing_units),
    householdGrowth: toNumber(demo?.household_growth),
    housingAgeDistribution: demo?.housing_age_distribution ?? null,
    demoDatasetYear: demo?.dataset_year ?? null,
    demoBaselineYear: demo?.baseline_dataset_year ?? null,
    demoDataSource: demo?.data_source ?? null,
    demoCollectionDate: demo?.collection_date ?? null,
    demoMethodologyVersion: demo?.methodology_version ?? null,
    demoQualityNotes: demo?.quality_notes ?? null,
    demoUpdatedAt: demo?.updated_at ?? null,
    treeCanopy: toNumber(env?.tree_canopy),
    rainfall: toNumber(env?.rainfall),
    stormIndicators: env?.storm_indicators ?? null,
    envDatasetYear: env?.dataset_year ?? null,
    envDataSource: env?.data_source ?? null,
    envCollectionDate: env?.collection_date ?? null,
    envMethodologyVersion: env?.methodology_version ?? null,
    envDataQuality: env?.data_quality ?? null,
    envQualityNotes: env?.quality_notes ?? null,
    envUpdatedAt: env?.updated_at ?? null,
    totalDiscovered: toNumber(metrics?.total_discovered),
    roofingExteriorCount: toNumber(metrics?.roofing_exterior_count),
    cleaningRepairCount: toNumber(metrics?.cleaning_repair_count),
    reviews50Plus: toNumber(metrics?.reviews_50_plus),
    reviews1000Plus: toNumber(metrics?.reviews_1000_plus),
    medianReviews: toNumber(metrics?.median_reviews),
    top3AvgReviews: toNumber(metrics?.top3_avg_reviews),
    competitorsPerOwnerHh: toNumber(metrics?.competitors_per_owner_hh),
    competitionComputedAt: metrics?.computed_at ?? null,
    competitionMethodologyVersion: metrics?.methodology_version ?? null,
    competitionDataSource: metrics?.data_source ?? null,
    competitionQualityNotes: metrics?.quality_notes ?? null,
    marketPotentialScore: toNumber(score?.market_potential_score),
    competitionScore: toNumber(score?.competition_score),
    mapsOpportunityScore: toNumber(score?.maps_opportunity_score),
    demographicScore: toNumber(score?.demographic_score),
    demandScore: toNumber(score?.demand_score),
    scoreAnalystNotes: score?.analyst_notes ?? null,
    scoreRisks: score?.risks ?? null,
    scoreAttractiveReasons: score?.attractive_reasons ?? null,
    scoreStatus: score?.status ?? null,
    scoreModelVersion: score?.model_version ?? null,
    scoreComputedAt: score?.computed_at ?? null,
    zipCodes: zips,
    digitalObservations,
    competitors,
  };

  return { project, market };
}
