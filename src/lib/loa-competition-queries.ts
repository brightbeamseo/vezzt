import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export type LoaCompetitionRow = {
  id: string;
  slug: string;
  displayName: string;
  state: string;
  macroMarketName: string;
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  population: number | null;
  populationGrowth: number | null;
  households: number | null;
  ownerOccupiedUnits: number | null;
  ownerOccupiedRate: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  housingUnits: number | null;
  housingGrowth: number | null;
  singleFamilyShare: number | null;
  demoQualityFlag: string | null;
  demoQualityNotes: string | null;
  gbpDiscoveryStatus: string | null;
  primaryInRadius: number | null;
  roofersPer100kPop: number | null;
  roofersPer10kOwnerHh: number | null;
  reviewsMedian: number | null;
  reviewsAvg: number | null;
  reviewsMax: number | null;
  reviews50Plus: number | null;
  reviews100Plus: number | null;
  reviews250Plus: number | null;
  reviews500Plus: number | null;
  reviews1000Plus: number | null;
  top5ReviewsAvg: number | null;
  top5ReviewsMedian: number | null;
  ownerHhPerRoofer: number | null;
  ownerHhPer50Plus: number | null;
  ownerHhPer100Plus: number | null;
  ownerHhPer250Plus: number | null;
  ownerHhPer500Plus: number | null;
  avgRating: number | null;
  searchPrimaryOutsideRadius: number | null;
  top10Competitors: unknown;
  anomalyNotes: string | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getLoaCompetitionRows(): Promise<LoaCompetitionRow[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("local_opportunity_areas")
    .select(
      `
      id,
      slug,
      display_name,
      state,
      center_lat,
      center_lng,
      radius_miles,
      population,
      population_growth,
      households,
      owner_occupied_units,
      owner_occupied_rate,
      median_household_income,
      median_home_value,
      housing_units,
      housing_growth,
      single_family_share,
      demo_quality_flag,
      demo_quality_notes,
      markets!inner ( market_name ),
      loa_roofing_competition (
        gbp_discovery_status,
        primary_in_radius,
        roofers_per_100k_pop,
        roofers_per_10k_owner_hh,
        reviews_median,
        reviews_avg,
        reviews_max,
        reviews_50_plus,
        reviews_100_plus,
        reviews_250_plus,
        reviews_500_plus,
        reviews_1000_plus,
        top5_reviews_avg,
        top5_reviews_median,
        owner_hh_per_roofer,
        owner_hh_per_50_plus,
        owner_hh_per_100_plus,
        owner_hh_per_250_plus,
        owner_hh_per_500_plus,
        avg_rating,
        search_primary_outside_radius,
        top10_competitors,
        anomaly_notes
      )
    `,
    )
    .order("population", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to load LOA competition: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const market = Array.isArray(row.markets) ? row.markets[0] : row.markets;
    const compRaw = row.loa_roofing_competition;
    const comp = Array.isArray(compRaw) ? compRaw[0] : compRaw;
    return {
      id: row.id as string,
      slug: row.slug as string,
      displayName: row.display_name as string,
      state: row.state as string,
      macroMarketName: (market?.market_name as string) ?? "—",
      centerLat: Number(row.center_lat),
      centerLng: Number(row.center_lng),
      radiusMiles: Number(row.radius_miles),
      population: (row.population as number | null) ?? null,
      populationGrowth: toNumber(row.population_growth as number | string | null),
      households: (row.households as number | null) ?? null,
      ownerOccupiedUnits: (row.owner_occupied_units as number | null) ?? null,
      ownerOccupiedRate: toNumber(
        row.owner_occupied_rate as number | string | null,
      ),
      medianHouseholdIncome: toNumber(
        row.median_household_income as number | string | null,
      ),
      medianHomeValue: toNumber(row.median_home_value as number | string | null),
      housingUnits: (row.housing_units as number | null) ?? null,
      housingGrowth: toNumber(row.housing_growth as number | string | null),
      singleFamilyShare: toNumber(
        row.single_family_share as number | string | null,
      ),
      demoQualityFlag: (row.demo_quality_flag as string | null) ?? null,
      demoQualityNotes: (row.demo_quality_notes as string | null) ?? null,
      gbpDiscoveryStatus: (comp?.gbp_discovery_status as string | null) ?? null,
      primaryInRadius: (comp?.primary_in_radius as number | null) ?? null,
      roofersPer100kPop: toNumber(
        comp?.roofers_per_100k_pop as number | string | null,
      ),
      roofersPer10kOwnerHh: toNumber(
        comp?.roofers_per_10k_owner_hh as number | string | null,
      ),
      reviewsMedian: toNumber(comp?.reviews_median as number | string | null),
      reviewsAvg: toNumber(comp?.reviews_avg as number | string | null),
      reviewsMax: (comp?.reviews_max as number | null) ?? null,
      reviews50Plus: (comp?.reviews_50_plus as number | null) ?? null,
      reviews100Plus: (comp?.reviews_100_plus as number | null) ?? null,
      reviews250Plus: (comp?.reviews_250_plus as number | null) ?? null,
      reviews500Plus: (comp?.reviews_500_plus as number | null) ?? null,
      reviews1000Plus: (comp?.reviews_1000_plus as number | null) ?? null,
      top5ReviewsAvg: toNumber(
        comp?.top5_reviews_avg as number | string | null,
      ),
      top5ReviewsMedian: toNumber(
        comp?.top5_reviews_median as number | string | null,
      ),
      ownerHhPerRoofer: toNumber(
        comp?.owner_hh_per_roofer as number | string | null,
      ),
      ownerHhPer50Plus: toNumber(
        comp?.owner_hh_per_50_plus as number | string | null,
      ),
      ownerHhPer100Plus: toNumber(
        comp?.owner_hh_per_100_plus as number | string | null,
      ),
      ownerHhPer250Plus: toNumber(
        comp?.owner_hh_per_250_plus as number | string | null,
      ),
      ownerHhPer500Plus: toNumber(
        comp?.owner_hh_per_500_plus as number | string | null,
      ),
      avgRating: toNumber(comp?.avg_rating as number | string | null),
      searchPrimaryOutsideRadius:
        (comp?.search_primary_outside_radius as number | null) ?? null,
      top10Competitors: comp?.top10_competitors ?? [],
      anomalyNotes: (comp?.anomaly_notes as string | null) ?? null,
    };
  });
}
