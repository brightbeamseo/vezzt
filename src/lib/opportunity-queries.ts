import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export type OpportunityMarketRow = {
  id: string;
  marketName: string;
  marketSlug: string;
  states: string[];
  state: string | null;
  marketType: string | null;
  cbsaCode: string | null;
  geographyName: string | null;
  centerLat: number | null;
  centerLng: number | null;
  population: number | null;
  populationGrowth: number | null;
  households: number | null;
  householdGrowth: number | null;
  ownerOccupiedUnits: number | null;
  ownerOccupiedRate: number | null;
  ownerOccupiedPer1kResidents: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  housingUnits: number | null;
  housingGrowth: number | null;
  singleFamilyDetachedUnits: number | null;
  singleFamilyShare: number | null;
  medianYearStructureBuilt: number | null;
  datasetYear: number | null;
  baselineDatasetYear: number | null;
  dataSource: string | null;
  lastUpdated: string | null;
  localityCount: number;
};

export type OpportunityLocality = {
  id: string;
  cityName: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  zoom: number | null;
  sortOrder: number;
};

export type OpportunityMarketDetail = OpportunityMarketRow & {
  timezone: string | null;
  localities: OpportunityLocality[];
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function asStates(value: unknown, fallback: string | null): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }
  return fallback ? [fallback] : [];
}

export async function getOpportunityMarkets(): Promise<OpportunityMarketRow[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("markets")
    .select(
      `
      id,
      market_name,
      market_slug,
      states,
      state,
      market_type,
      cbsa_code,
      geography_name,
      center_lat,
      center_lng,
      population,
      population_growth,
      households,
      household_growth,
      owner_occupied_units,
      owner_occupied_rate,
      owner_occupied_per_1k_residents,
      median_household_income,
      median_home_value,
      housing_units,
      housing_growth,
      single_family_detached_units,
      single_family_share,
      median_year_structure_built,
      dataset_year,
      baseline_dataset_year,
      data_source,
      last_updated,
      market_localities ( id )
    `,
    )
    .eq("opportunity_enabled", true)
    .order("population", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error(`Failed to load opportunity markets: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const localities = Array.isArray(row.market_localities)
      ? row.market_localities
      : [];
    return {
      id: row.id as string,
      marketName: row.market_name as string,
      marketSlug: row.market_slug as string,
      states: asStates(row.states, (row.state as string | null) ?? null),
      state: (row.state as string | null) ?? null,
      marketType: (row.market_type as string | null) ?? null,
      cbsaCode: (row.cbsa_code as string | null) ?? null,
      geographyName: (row.geography_name as string | null) ?? null,
      centerLat: toNumber(row.center_lat as number | string | null),
      centerLng: toNumber(row.center_lng as number | string | null),
      population: (row.population as number | null) ?? null,
      populationGrowth: toNumber(row.population_growth as number | string | null),
      households: (row.households as number | null) ?? null,
      householdGrowth: toNumber(row.household_growth as number | string | null),
      ownerOccupiedUnits: (row.owner_occupied_units as number | null) ?? null,
      ownerOccupiedRate: toNumber(
        row.owner_occupied_rate as number | string | null,
      ),
      ownerOccupiedPer1kResidents: toNumber(
        row.owner_occupied_per_1k_residents as number | string | null,
      ),
      medianHouseholdIncome: toNumber(
        row.median_household_income as number | string | null,
      ),
      medianHomeValue: toNumber(row.median_home_value as number | string | null),
      housingUnits: (row.housing_units as number | null) ?? null,
      housingGrowth: toNumber(row.housing_growth as number | string | null),
      singleFamilyDetachedUnits:
        (row.single_family_detached_units as number | null) ?? null,
      singleFamilyShare: toNumber(
        row.single_family_share as number | string | null,
      ),
      medianYearStructureBuilt: toNumber(
        row.median_year_structure_built as number | string | null,
      ),
      datasetYear: (row.dataset_year as number | null) ?? null,
      baselineDatasetYear: (row.baseline_dataset_year as number | null) ?? null,
      dataSource: (row.data_source as string | null) ?? null,
      lastUpdated: (row.last_updated as string | null) ?? null,
      localityCount: localities.length,
    };
  });
}

export async function getOpportunityMarketByIdOrSlug(
  idOrSlug: string,
): Promise<OpportunityMarketDetail | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const byId = await supabase
    .from("markets")
    .select(
      `
      id,
      market_name,
      market_slug,
      states,
      state,
      market_type,
      timezone,
      cbsa_code,
      geography_name,
      center_lat,
      center_lng,
      population,
      population_growth,
      households,
      household_growth,
      owner_occupied_units,
      owner_occupied_rate,
      owner_occupied_per_1k_residents,
      median_household_income,
      median_home_value,
      housing_units,
      housing_growth,
      single_family_detached_units,
      single_family_share,
      median_year_structure_built,
      dataset_year,
      baseline_dataset_year,
      data_source,
      last_updated,
      market_localities (
        id,
        city_name,
        state,
        latitude,
        longitude,
        zoom,
        sort_order
      )
    `,
    )
    .eq("opportunity_enabled", true)
    .or(`id.eq.${idOrSlug},market_slug.eq.${idOrSlug}`)
    .maybeSingle();

  if (byId.error) {
    throw new Error(`Failed to load market: ${byId.error.message}`);
  }
  if (!byId.data) return null;

  const row = byId.data;
  const localitiesRaw = Array.isArray(row.market_localities)
    ? row.market_localities
    : [];

  const localities: OpportunityLocality[] = localitiesRaw
    .map((l) => ({
      id: l.id as string,
      cityName: l.city_name as string,
      state: l.state as string,
      latitude: toNumber(l.latitude as number | string | null),
      longitude: toNumber(l.longitude as number | string | null),
      zoom: (l.zoom as number | null) ?? null,
      sortOrder: (l.sort_order as number | null) ?? 0,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.cityName.localeCompare(b.cityName));

  return {
    id: row.id as string,
    marketName: row.market_name as string,
    marketSlug: row.market_slug as string,
    states: asStates(row.states, (row.state as string | null) ?? null),
    state: (row.state as string | null) ?? null,
    marketType: (row.market_type as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    cbsaCode: (row.cbsa_code as string | null) ?? null,
    geographyName: (row.geography_name as string | null) ?? null,
    centerLat: toNumber(row.center_lat as number | string | null),
    centerLng: toNumber(row.center_lng as number | string | null),
    population: (row.population as number | null) ?? null,
    populationGrowth: toNumber(row.population_growth as number | string | null),
    households: (row.households as number | null) ?? null,
    householdGrowth: toNumber(row.household_growth as number | string | null),
    ownerOccupiedUnits: (row.owner_occupied_units as number | null) ?? null,
    ownerOccupiedRate: toNumber(
      row.owner_occupied_rate as number | string | null,
    ),
    ownerOccupiedPer1kResidents: toNumber(
      row.owner_occupied_per_1k_residents as number | string | null,
    ),
    medianHouseholdIncome: toNumber(
      row.median_household_income as number | string | null,
    ),
    medianHomeValue: toNumber(row.median_home_value as number | string | null),
    housingUnits: (row.housing_units as number | null) ?? null,
    housingGrowth: toNumber(row.housing_growth as number | string | null),
    singleFamilyDetachedUnits:
      (row.single_family_detached_units as number | null) ?? null,
    singleFamilyShare: toNumber(
      row.single_family_share as number | string | null,
    ),
    medianYearStructureBuilt: toNumber(
      row.median_year_structure_built as number | string | null,
    ),
    datasetYear: (row.dataset_year as number | null) ?? null,
    baselineDatasetYear: (row.baseline_dataset_year as number | null) ?? null,
    dataSource: (row.data_source as string | null) ?? null,
    lastUpdated: (row.last_updated as string | null) ?? null,
    localityCount: localities.length,
    localities,
  };
}
