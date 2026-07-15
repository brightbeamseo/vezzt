/**
 * Market-level Census enrichment (ACS 5-Year CBSA / metro).
 * Server-side only — never expose CENSUS_API_KEY to the client.
 */
import type { Client } from "pg";
import { MARKETS, type MarketId, normalizeCityName } from "@/lib/markets";
import {
  CENSUS_ACS_BASE,
  CENSUS_ACS_VARIABLES,
  CENSUS_DATASET_YEAR,
  computeOwnerOccupiedRate,
  parseCensusNumber,
} from "@/lib/census/zcta";

export const CENSUS_API_KEY_MISSING_MESSAGE = "Census API key not configured.";
export const CENSUS_API_KEY_CLI_MISSING_MESSAGE = "CENSUS_API_KEY missing.";

/** Official ACS geography name for metro/micro statistical areas (CBSA). */
export const CENSUS_CBSA_GEOGRAPHY =
  "metropolitan statistical area/micropolitan statistical area";

export const MARKET_CENSUS_DATA_SOURCE = "US Census ACS 5-Year";

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

export type MarketAcsStats = {
  cbsaCode: string;
  name: string | null;
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupiedUnits: number | null;
  ownerOccupiedRate: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  medianYearStructureBuilt: number | null;
  datasetYear: number;
  dataSource: string;
  endpoint: string;
  httpStatus: number;
  rawResponse: unknown;
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

type CensusTable = string[][];

function censusTableToObjects(table: CensusTable): Record<string, string>[] {
  if (!Array.isArray(table) || table.length < 2) return [];
  const headers = table[0]!;
  return table.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

function redactKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("key")) u.searchParams.set("key", "[redacted]");
    return u.toString();
  } catch {
    return url.replace(/([?&]key=)[^&]+/i, "$1[redacted]");
  }
}

/**
 * Resolve CBSA code from Census ACS metro/micro geography by NAME match.
 * Does not invent codes — returns matches from the live geography listing.
 */
export async function resolveCbsaCodeFromCensus(input: {
  nameIncludes: string[];
  apiKey?: string | null;
}): Promise<{
  cbsaCode: string;
  name: string;
  endpoint: string;
  httpStatus: number;
  candidates: Array<{ name: string; cbsaCode: string }>;
}> {
  const apiKey = input.apiKey?.trim() || requireCensusApiKey();
  const params = new URLSearchParams();
  params.set("get", "NAME");
  params.set("for", `${CENSUS_CBSA_GEOGRAPHY}:*`);
  params.set("key", apiKey);
  const endpoint = `${CENSUS_ACS_BASE}?${params.toString()}`;

  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "follow",
  });
  const bodyText = await res.text();
  const safeEndpoint = redactKeyFromUrl(endpoint);

  if (
    !res.ok ||
    bodyText.includes("Missing Key") ||
    !bodyText.trim().startsWith("[")
  ) {
    throw new Error(
      `Census CBSA geography lookup failed (HTTP ${res.status}): ${bodyText.slice(0, 200)}`,
    );
  }

  const table = JSON.parse(bodyText) as CensusTable;
  const objects = censusTableToObjects(table);
  const needles = input.nameIncludes.map((n) => n.toLowerCase());

  const candidates = objects
    .map((row) => ({
      name: (row.NAME ?? "").trim(),
      cbsaCode: (row[CENSUS_CBSA_GEOGRAPHY] ?? "").trim(),
    }))
    .filter((c) => c.name && c.cbsaCode)
    .filter((c) => {
      const lower = c.name.toLowerCase();
      return needles.every((n) => lower.includes(n));
    });

  if (candidates.length === 0) {
    throw new Error(
      `No CBSA matched name filters: ${input.nameIncludes.join(", ")}`,
    );
  }

  const preferred =
    candidates.find((c) => /metro area/i.test(c.name)) ?? candidates[0]!;

  return {
    cbsaCode: preferred.cbsaCode,
    name: preferred.name,
    endpoint: safeEndpoint,
    httpStatus: res.status,
    candidates,
  };
}

export function buildCensusCbsaUrl(
  cbsaCode: string,
  apiKey?: string | null,
): string {
  const code = cbsaCode.trim();
  if (!/^\d{5}$/.test(code)) {
    throw new Error(`Invalid CBSA code "${cbsaCode}"`);
  }
  const params = new URLSearchParams();
  params.set("get", CENSUS_ACS_VARIABLES.join(","));
  params.set("for", `${CENSUS_CBSA_GEOGRAPHY}:${code}`);
  if (apiKey) params.set("key", apiKey);
  return `${CENSUS_ACS_BASE}?${params.toString()}`;
}

/** Fetch ACS 5-Year Detailed Tables for a verified CBSA code. */
export async function fetchMarketAcsByCbsa(input: {
  cbsaCode: string;
  apiKey?: string | null;
}): Promise<MarketAcsStats> {
  const apiKey = input.apiKey?.trim() || requireCensusApiKey();
  const endpoint = buildCensusCbsaUrl(input.cbsaCode, apiKey);
  const safeEndpoint = redactKeyFromUrl(endpoint);

  const res = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "follow",
  });
  const bodyText = await res.text();

  if (
    !res.ok ||
    bodyText.includes("Missing Key") ||
    !bodyText.trim().startsWith("[")
  ) {
    throw new Error(
      `Census CBSA ACS fetch failed (HTTP ${res.status}): ${bodyText.slice(0, 200)}`,
    );
  }

  const table = JSON.parse(bodyText) as CensusTable;
  const objects = censusTableToObjects(table);
  const row = objects[0];
  if (!row) {
    throw new Error(`Census returned no rows for CBSA ${input.cbsaCode}`);
  }

  const population = parseCensusNumber(row.B01003_001E);
  const households = parseCensusNumber(row.B11001_001E);
  const housingUnits = parseCensusNumber(row.B25001_001E);
  const ownerOccupiedUnits = parseCensusNumber(row.B25003_002E);

  return {
    cbsaCode: input.cbsaCode,
    name: row.NAME?.trim() || null,
    population,
    households,
    housingUnits,
    ownerOccupiedUnits,
    ownerOccupiedRate: computeOwnerOccupiedRate(
      ownerOccupiedUnits,
      households,
    ),
    medianHouseholdIncome: parseCensusNumber(row.B19013_001E),
    medianHomeValue: parseCensusNumber(row.B25077_001E),
    medianYearStructureBuilt: parseCensusNumber(row.B25035_001E),
    datasetYear: CENSUS_DATASET_YEAR,
    dataSource: MARKET_CENSUS_DATA_SOURCE,
    endpoint: safeEndpoint,
    httpStatus: res.status,
    rawResponse: row,
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
 * unless explicitly provided.
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
    requireApiKey?: boolean;
  },
): Promise<MarketRecord> {
  if (input.requireApiKey) {
    requireCensusApiKey();
  }

  const normalized = normalizeMarket(input);
  const hasStats =
    input.population != null ||
    input.households != null ||
    input.medianHouseholdIncome != null ||
    input.datasetYear != null;

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
      case when $21::boolean then now() else null end,
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
        when $21::boolean then now()
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
      hasStats,
    ],
  );

  return mapMarketRow(rows[0] as Record<string, unknown>);
}

/**
 * Apply Census ACS stats onto an existing market row (by slug).
 * Replaces Census statistic columns; does not invent values.
 */
export async function applyMarketCensusStats(
  db: Client,
  marketSlug: string,
  stats: MarketAcsStats,
): Promise<MarketRecord> {
  requireCensusApiKey();

  const { rows } = await db.query(
    `update public.markets set
       cbsa_code = $2,
       population = $3,
       households = $4,
       housing_units = $5,
       owner_occupied_units = $6,
       owner_occupied_rate = $7,
       median_household_income = $8,
       median_home_value = $9,
       median_year_structure_built = $10,
       dataset_year = $11,
       data_source = $12,
       raw_response = $13::jsonb,
       last_updated = now(),
       updated_at = now()
     where market_slug = $1
     returning *`,
    [
      marketSlug,
      stats.cbsaCode,
      stats.population,
      stats.households,
      stats.housingUnits,
      stats.ownerOccupiedUnits,
      stats.ownerOccupiedRate,
      stats.medianHouseholdIncome,
      stats.medianHomeValue,
      stats.medianYearStructureBuilt,
      stats.datasetYear,
      stats.dataSource,
      JSON.stringify(stats.rawResponse),
    ],
  );

  if (!rows[0]) {
    throw new Error(
      `Market slug "${marketSlug}" not found — cannot apply Census stats`,
    );
  }
  return mapMarketRow(rows[0] as Record<string, unknown>);
}

/**
 * Full Boise Metro enrichment path: resolve CBSA from Census → ACS fetch → upsert.
 */
export async function enrichMarketFromCensus(input: {
  db: Client;
  marketSlug: string;
  nameIncludes: string[];
}): Promise<{
  market: MarketRecord;
  resolved: Awaited<ReturnType<typeof resolveCbsaCodeFromCensus>>;
  stats: MarketAcsStats;
}> {
  const apiKey = requireCensusApiKey();
  const resolved = await resolveCbsaCodeFromCensus({
    nameIncludes: input.nameIncludes,
    apiKey,
  });
  const stats = await fetchMarketAcsByCbsa({
    cbsaCode: resolved.cbsaCode,
    apiKey,
  });
  const market = await applyMarketCensusStats(
    input.db,
    input.marketSlug,
    stats,
  );
  return { market, resolved, stats };
}

/**
 * Assign businesses to a market by UUID (FK). Does not copy market stats.
 */
export async function assignBusinessesToMarket(
  db: Client,
  input: {
    marketId: string;
    targetSector?: string | null;
    cities?: string[] | null;
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
