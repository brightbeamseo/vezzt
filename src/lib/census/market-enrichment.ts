/**
 * Market-level Census enrichment architecture.
 *
 * Intentionally does NOT call the Census API yet.
 * Once CENSUS_API_KEY is configured, wire fetchMarket() to ACS / CBSA endpoints
 * and run `npm run enrich:markets`.
 *
 * Server-side only — never expose CENSUS_API_KEY to the client.
 */
import type { Client } from "pg";
import { MARKETS, type MarketId, normalizeCityName } from "@/lib/markets";

export const CENSUS_API_KEY_MISSING_MESSAGE = "Census API key not configured.";
export const CENSUS_API_KEY_CLI_MISSING_MESSAGE = "CENSUS_API_KEY missing.";

export type MarketType = "metro" | "msa" | "state" | "custom";

export type MarketRecord = {
  id: string;
  marketName: string;
  marketSlug: string;
  marketType: MarketType | null;
  cbsaCode: string | null;
  state: string | null;
  timezone: string | null;
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupiedUnits: number | null;
  ownerOccupiedRate: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  medianYearStructureBuilt: number | null;
  populationGrowth: number | null;
  housingGrowth: number | null;
  annualBuildingPermits: number | null;
  datasetYear: number | null;
  dataSource: string | null;
  lastUpdated: string | null;
  rawResponse: unknown | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type NormalizeMarketInput = {
  marketName: string;
  marketSlug?: string | null;
  marketType?: MarketType | string | null;
  cbsaCode?: string | null;
  state?: string | null;
  timezone?: string | null;
};

/** Friendly gate for UI / services when enrichment is disabled. */
export function isCensusApiKeyConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.CENSUS_API_KEY?.trim());
}

export function requireCensusApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const key = env.CENSUS_API_KEY?.trim();
  if (!key) {
    throw new Error(CENSUS_API_KEY_MISSING_MESSAGE);
  }
  return key;
}

export function normalizeMarketSlug(input: string | null | undefined): string {
  return (input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeMarketType(
  input: string | null | undefined,
): MarketType | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v === "metro" || v === "msa" || v === "state" || v === "custom") {
    return v;
  }
  return null;
}

/**
 * Normalize inbound market identity fields. Does not invent Census values.
 */
export function normalizeMarket(input: NormalizeMarketInput): {
  marketName: string;
  marketSlug: string;
  marketType: MarketType | null;
  cbsaCode: string | null;
  state: string | null;
  timezone: string | null;
} {
  const marketName = input.marketName.trim();
  if (!marketName) {
    throw new Error("marketName is required");
  }
  const marketSlug =
    normalizeMarketSlug(input.marketSlug) ||
    normalizeMarketSlug(marketName);
  if (!marketSlug) {
    throw new Error("marketSlug could not be derived");
  }
  return {
    marketName,
    marketSlug,
    marketType: normalizeMarketType(input.marketType ?? null),
    cbsaCode: input.cbsaCode?.trim() || null,
    state: input.state?.trim() || null,
    timezone: input.timezone?.trim() || null,
  };
}

function mapMarketRow(row: Record<string, unknown>): MarketRecord {
  return {
    id: String(row.id),
    marketName: String(row.market_name),
    marketSlug: String(row.market_slug),
    marketType: normalizeMarketType(row.market_type as string | null),
    cbsaCode: (row.cbsa_code as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    timezone: (row.timezone as string | null) ?? null,
    population: (row.population as number | null) ?? null,
    households: (row.households as number | null) ?? null,
    housingUnits: (row.housing_units as number | null) ?? null,
    ownerOccupiedUnits: (row.owner_occupied_units as number | null) ?? null,
    ownerOccupiedRate:
      row.owner_occupied_rate === null || row.owner_occupied_rate === undefined
        ? null
        : Number(row.owner_occupied_rate),
    medianHouseholdIncome:
      row.median_household_income === null ||
      row.median_household_income === undefined
        ? null
        : Number(row.median_household_income),
    medianHomeValue:
      row.median_home_value === null || row.median_home_value === undefined
        ? null
        : Number(row.median_home_value),
    medianYearStructureBuilt:
      row.median_year_structure_built === null ||
      row.median_year_structure_built === undefined
        ? null
        : Number(row.median_year_structure_built),
    populationGrowth:
      row.population_growth === null || row.population_growth === undefined
        ? null
        : Number(row.population_growth),
    housingGrowth:
      row.housing_growth === null || row.housing_growth === undefined
        ? null
        : Number(row.housing_growth),
    annualBuildingPermits:
      (row.annual_building_permits as number | null) ?? null,
    datasetYear: (row.dataset_year as number | null) ?? null,
    dataSource: (row.data_source as string | null) ?? null,
    lastUpdated: (row.last_updated as string | null) ?? null,
    rawResponse: row.raw_response ?? null,
    createdAt: (row.created_at as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

/** Load a market by UUID or market_slug. */
export async function fetchMarket(
  db: Client,
  idOrSlug: string,
): Promise<MarketRecord | null> {
  const { rows } = await db.query(
    `select *
     from public.markets
     where id::text = $1
        or market_slug = $1
     limit 1`,
    [idOrSlug],
  );
  if (!rows[0]) return null;
  return mapMarketRow(rows[0] as Record<string, unknown>);
}

/**
 * Upsert market identity row. Census statistic columns are left unchanged
 * unless explicitly provided (enrichment path — not implemented yet).
 */
export async function upsertMarket(
  db: Client,
  input: NormalizeMarketInput & {
    population?: number | null;
    households?: number | null;
    housingUnits?: number | null;
    ownerOccupiedUnits?: number | null;
    ownerOccupiedRate?: number | null;
    medianHouseholdIncome?: number | null;
    medianHomeValue?: number | null;
    medianYearStructureBuilt?: number | null;
    populationGrowth?: number | null;
    housingGrowth?: number | null;
    annualBuildingPermits?: number | null;
    datasetYear?: number | null;
    dataSource?: string | null;
    rawResponse?: unknown | null;
    /** When true, requires CENSUS_API_KEY (future enrichment path). */
    requireApiKey?: boolean;
  },
): Promise<MarketRecord> {
  if (input.requireApiKey) {
    requireCensusApiKey();
  }

  const normalized = normalizeMarket(input);

  const { rows } = await db.query(
    `insert into public.markets (
      market_name,
      market_slug,
      market_type,
      cbsa_code,
      state,
      timezone,
      population,
      households,
      housing_units,
      owner_occupied_units,
      owner_occupied_rate,
      median_household_income,
      median_home_value,
      median_year_structure_built,
      population_growth,
      housing_growth,
      annual_building_permits,
      dataset_year,
      data_source,
      raw_response,
      last_updated,
      updated_at
    ) values (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb,
      case when $7::int is not null or $8::int is not null then now() else null end,
      now()
    )
    on conflict (market_slug) do update set
      market_name = excluded.market_name,
      market_type = coalesce(excluded.market_type, public.markets.market_type),
      cbsa_code = coalesce(excluded.cbsa_code, public.markets.cbsa_code),
      state = coalesce(excluded.state, public.markets.state),
      timezone = coalesce(excluded.timezone, public.markets.timezone),
      population = coalesce(excluded.population, public.markets.population),
      households = coalesce(excluded.households, public.markets.households),
      housing_units = coalesce(excluded.housing_units, public.markets.housing_units),
      owner_occupied_units = coalesce(excluded.owner_occupied_units, public.markets.owner_occupied_units),
      owner_occupied_rate = coalesce(excluded.owner_occupied_rate, public.markets.owner_occupied_rate),
      median_household_income = coalesce(excluded.median_household_income, public.markets.median_household_income),
      median_home_value = coalesce(excluded.median_home_value, public.markets.median_home_value),
      median_year_structure_built = coalesce(excluded.median_year_structure_built, public.markets.median_year_structure_built),
      population_growth = coalesce(excluded.population_growth, public.markets.population_growth),
      housing_growth = coalesce(excluded.housing_growth, public.markets.housing_growth),
      annual_building_permits = coalesce(excluded.annual_building_permits, public.markets.annual_building_permits),
      dataset_year = coalesce(excluded.dataset_year, public.markets.dataset_year),
      data_source = coalesce(excluded.data_source, public.markets.data_source),
      raw_response = coalesce(excluded.raw_response, public.markets.raw_response),
      last_updated = case
        when excluded.population is not null
          or excluded.households is not null
          or excluded.median_household_income is not null
        then now()
        else public.markets.last_updated
      end,
      updated_at = now()
    returning *`,
    [
      normalized.marketName,
      normalized.marketSlug,
      normalized.marketType,
      normalized.cbsaCode,
      normalized.state,
      normalized.timezone,
      input.population ?? null,
      input.households ?? null,
      input.housingUnits ?? null,
      input.ownerOccupiedUnits ?? null,
      input.ownerOccupiedRate ?? null,
      input.medianHouseholdIncome ?? null,
      input.medianHomeValue ?? null,
      input.medianYearStructureBuilt ?? null,
      input.populationGrowth ?? null,
      input.housingGrowth ?? null,
      input.annualBuildingPermits ?? null,
      input.datasetYear ?? null,
      input.dataSource ?? null,
      input.rawResponse != null ? JSON.stringify(input.rawResponse) : null,
    ],
  );

  return mapMarketRow(rows[0] as Record<string, unknown>);
}

/**
 * Assign businesses to a market by UUID (FK). Does not copy market stats.
 */
export async function assignBusinessesToMarket(
  db: Client,
  input: {
    marketId: string;
    /** Limit to target sector when set (e.g. roofing). */
    targetSector?: string | null;
    /** Optional city allowlist (case-insensitive). */
    cities?: string[] | null;
    /** When true, only update rows that currently have null market_id. */
    onlyUnassigned?: boolean;
  },
): Promise<{ updated: number }> {
  const cities = (input.cities ?? []).map(normalizeCityName).filter(Boolean);
  const params: unknown[] = [input.marketId];
  const clauses: string[] = [];

  if (input.onlyUnassigned) {
    clauses.push("b.market_id is null");
  }
  if (input.targetSector) {
    params.push(input.targetSector);
    clauses.push(`b.target_sector = $${params.length}`);
  }
  if (cities.length > 0) {
    params.push(cities);
    clauses.push(
      `lower(trim(coalesce(b.city, ''))) = any($${params.length}::text[])`,
    );
  }

  if (clauses.length === 0) {
    throw new Error(
      "assignBusinessesToMarket requires targetSector, cities, and/or onlyUnassigned",
    );
  }

  const where = `where ${clauses.join(" and ")}`;

  const { rowCount } = await db.query(
    `update public.businesses b
     set market_id = $1::uuid,
         updated_at = now()
     ${where}`,
    params,
  );

  return { updated: rowCount ?? 0 };
}

/** Resolve DB market UUID from collection MarketId slug. */
export async function resolveMarketUuid(
  db: Client,
  slug: string = "boise-metro",
): Promise<string> {
  const market = await fetchMarket(db, slug);
  if (!market) {
    const known = Object.keys(MARKETS).join(", ");
    throw new Error(
      `Market slug "${slug}" not found in public.markets. Known code markets: ${known}`,
    );
  }
  return market.id;
}

/** Ensure Boise Metro (and other code MARKETS) exist as DB rows — no Census values. */
export async function ensureCodeMarketsSeeded(db: Client): Promise<void> {
  for (const def of Object.values(MARKETS)) {
    await upsertMarket(db, {
      marketName: def.name,
      marketSlug: def.id as MarketId,
      marketType: "metro",
      state: def.state,
      timezone: def.timezone,
    });
  }
}
