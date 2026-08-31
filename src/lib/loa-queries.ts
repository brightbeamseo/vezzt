import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export type LocalOpportunityAreaRow = {
  id: string;
  slug: string;
  displayName: string;
  state: string;
  macroMarketId: string;
  macroMarketName: string;
  macroMarketSlug: string;
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  placePopulation: number | null;
  population: number | null;
  populationGrowth: number | null;
  households: number | null;
  ownerOccupiedUnits: number | null;
  ownerOccupiedRate: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  singleFamilyShare: number | null;
  housingGrowth: number | null;
  zctaCount: number | null;
  datasetYear: number | null;
  companionPlaces: string[];
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function getLocalOpportunityAreas(): Promise<
  LocalOpportunityAreaRow[]
> {
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
      macro_market_id,
      center_lat,
      center_lng,
      radius_miles,
      place_population,
      population,
      population_growth,
      households,
      owner_occupied_units,
      owner_occupied_rate,
      median_household_income,
      median_home_value,
      single_family_share,
      housing_growth,
      zcta_count,
      dataset_year,
      companion_places,
      markets!inner (
        market_name,
        market_slug
      )
    `,
    )
    .order("population", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to load local opportunity areas: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const market = Array.isArray(row.markets) ? row.markets[0] : row.markets;
    return {
      id: row.id as string,
      slug: row.slug as string,
      displayName: row.display_name as string,
      state: row.state as string,
      macroMarketId: row.macro_market_id as string,
      macroMarketName: (market?.market_name as string) ?? "—",
      macroMarketSlug: (market?.market_slug as string) ?? "—",
      centerLat: Number(row.center_lat),
      centerLng: Number(row.center_lng),
      radiusMiles: Number(row.radius_miles),
      placePopulation: (row.place_population as number | null) ?? null,
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
      singleFamilyShare: toNumber(
        row.single_family_share as number | string | null,
      ),
      housingGrowth: toNumber(row.housing_growth as number | string | null),
      zctaCount: (row.zcta_count as number | null) ?? null,
      datasetYear: (row.dataset_year as number | null) ?? null,
      companionPlaces: Array.isArray(row.companion_places)
        ? (row.companion_places as string[])
        : [],
    };
  });
}
