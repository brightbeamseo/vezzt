/**
 * Market Opportunity Census enrichment helpers.
 * Extends CBSA ACS pulls with growth (2019→2024) and single-family share.
 * Server-side only.
 */
import type { Client } from "pg";
import {
  CENSUS_ACS_BASE,
  CENSUS_DATASET_YEAR,
  computeOwnerOccupiedRate,
  parseCensusNumber,
} from "@/lib/census/zcta";
import {
  CENSUS_CBSA_GEOGRAPHY,
  MARKET_CENSUS_DATA_SOURCE,
  fetchMarketAcsByCbsa,
  resolveCbsaCodeFromCensus,
  type MarketAcsStats,
} from "@/lib/census/market-enrichment";
import type { OpportunityMarketDefinition } from "@/lib/opportunity-markets";

/** ACS vintage used as growth baseline (multi-year comparison). */
export const OPPORTUNITY_BASELINE_ACS_YEAR = 2019;
export const OPPORTUNITY_CURRENT_ACS_YEAR = CENSUS_DATASET_YEAR; // 2024

export const OPPORTUNITY_ACS_EXTRA_VARS = [
  "B25024_002E", // 1-unit detached housing units
] as const;

export type OpportunityAcsSnapshot = {
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupiedUnits: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  medianYearStructureBuilt: number | null;
  singleFamilyDetachedUnits: number | null;
  datasetYear: number;
  geographyName: string | null;
  rawResponse: unknown;
  endpoint: string;
};

export type OpportunityMarketStats = {
  cbsaCode: string;
  geographyName: string | null;
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupiedUnits: number | null;
  ownerOccupiedRate: number | null;
  ownerOccupiedPer1kResidents: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  medianYearStructureBuilt: number | null;
  singleFamilyDetachedUnits: number | null;
  singleFamilyShare: number | null;
  populationGrowth: number | null;
  householdGrowth: number | null;
  housingGrowth: number | null;
  datasetYear: number;
  baselineDatasetYear: number;
  dataSource: string;
  rawResponse: unknown;
};

function redactKeyFromUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has("key")) u.searchParams.set("key", "[redacted]");
    return u.toString();
  } catch {
    return url.replace(/([?&]key=)[^&]+/i, "$1[redacted]");
  }
}

function censusTableToObjects(table: string[][]): Record<string, string>[] {
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

function pctChange(
  current: number | null,
  baseline: number | null,
): number | null {
  if (
    current === null ||
    baseline === null ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  ) {
    return null;
  }
  return ((current - baseline) / baseline) * 100;
}

function share(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole <= 0) return null;
  return part / whole;
}

function per1k(count: number | null, population: number | null): number | null {
  if (count === null || population === null || population <= 0) return null;
  return (count / population) * 1000;
}

const CORE_VARS = [
  "NAME",
  "B01003_001E",
  "B11001_001E",
  "B25001_001E",
  "B25003_002E",
  "B19013_001E",
  "B25077_001E",
  "B25035_001E",
  "B25024_002E",
] as const;

export async function fetchOpportunityAcsSnapshot(input: {
  cbsaCode: string;
  datasetYear: number;
  apiKey: string;
}): Promise<OpportunityAcsSnapshot> {
  const base = `https://api.census.gov/data/${input.datasetYear}/acs/acs5`;
  const params = new URLSearchParams();
  params.set("get", CORE_VARS.join(","));
  params.set("for", `${CENSUS_CBSA_GEOGRAPHY}:${input.cbsaCode}`);
  params.set("key", input.apiKey);
  const endpoint = `${base}?${params.toString()}`;
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
      `Census ACS ${input.datasetYear} CBSA ${input.cbsaCode} failed (HTTP ${res.status}): ${bodyText.slice(0, 200)}`,
    );
  }

  const table = JSON.parse(bodyText) as string[][];
  const row = censusTableToObjects(table)[0];
  if (!row) {
    throw new Error(
      `Census returned no rows for CBSA ${input.cbsaCode} year ${input.datasetYear}`,
    );
  }

  return {
    population: parseCensusNumber(row.B01003_001E),
    households: parseCensusNumber(row.B11001_001E),
    housingUnits: parseCensusNumber(row.B25001_001E),
    ownerOccupiedUnits: parseCensusNumber(row.B25003_002E),
    medianHouseholdIncome: parseCensusNumber(row.B19013_001E),
    medianHomeValue: parseCensusNumber(row.B25077_001E),
    medianYearStructureBuilt: parseCensusNumber(row.B25035_001E),
    singleFamilyDetachedUnits: parseCensusNumber(row.B25024_002E),
    datasetYear: input.datasetYear,
    geographyName: row.NAME?.trim() || null,
    rawResponse: row,
    endpoint: safeEndpoint,
  };
}

export async function resolveOpportunityCbsa(
  def: OpportunityMarketDefinition,
  apiKey: string,
): Promise<{ cbsaCode: string; geographyName: string | null }> {
  if (def.cbsaCode && /^\d{5}$/.test(def.cbsaCode)) {
    // Verify code exists in current ACS; fall back to name match on failure.
    try {
      const snap = await fetchOpportunityAcsSnapshot({
        cbsaCode: def.cbsaCode,
        datasetYear: OPPORTUNITY_CURRENT_ACS_YEAR,
        apiKey,
      });
      return {
        cbsaCode: def.cbsaCode,
        geographyName: snap.geographyName,
      };
    } catch {
      // fall through to name resolution
    }
  }

  if (!def.cbsaNameIncludes?.length) {
    throw new Error(
      `No valid CBSA for market ${def.slug} (code=${def.cbsaCode ?? "none"})`,
    );
  }

  const resolved = await resolveCbsaCodeFromCensus({
    nameIncludes: def.cbsaNameIncludes,
    apiKey,
  });
  return { cbsaCode: resolved.cbsaCode, geographyName: resolved.name };
}

export async function buildOpportunityMarketStats(input: {
  cbsaCode: string;
  apiKey: string;
}): Promise<OpportunityMarketStats> {
  const current = await fetchOpportunityAcsSnapshot({
    cbsaCode: input.cbsaCode,
    datasetYear: OPPORTUNITY_CURRENT_ACS_YEAR,
    apiKey: input.apiKey,
  });

  let baseline: OpportunityAcsSnapshot | null = null;
  try {
    baseline = await fetchOpportunityAcsSnapshot({
      cbsaCode: input.cbsaCode,
      datasetYear: OPPORTUNITY_BASELINE_ACS_YEAR,
      apiKey: input.apiKey,
    });
  } catch {
    baseline = null;
  }

  return {
    cbsaCode: input.cbsaCode,
    geographyName: current.geographyName,
    population: current.population,
    households: current.households,
    housingUnits: current.housingUnits,
    ownerOccupiedUnits: current.ownerOccupiedUnits,
    ownerOccupiedRate: computeOwnerOccupiedRate(
      current.ownerOccupiedUnits,
      current.households,
    ),
    ownerOccupiedPer1kResidents: per1k(
      current.ownerOccupiedUnits,
      current.population,
    ),
    medianHouseholdIncome: current.medianHouseholdIncome,
    medianHomeValue: current.medianHomeValue,
    medianYearStructureBuilt: current.medianYearStructureBuilt,
    singleFamilyDetachedUnits: current.singleFamilyDetachedUnits,
    singleFamilyShare: share(
      current.singleFamilyDetachedUnits,
      current.housingUnits,
    ),
    populationGrowth: pctChange(current.population, baseline?.population ?? null),
    householdGrowth: pctChange(current.households, baseline?.households ?? null),
    housingGrowth: pctChange(
      current.housingUnits,
      baseline?.housingUnits ?? null,
    ),
    datasetYear: OPPORTUNITY_CURRENT_ACS_YEAR,
    baselineDatasetYear: OPPORTUNITY_BASELINE_ACS_YEAR,
    dataSource: `${MARKET_CENSUS_DATA_SOURCE} (${OPPORTUNITY_BASELINE_ACS_YEAR}→${OPPORTUNITY_CURRENT_ACS_YEAR})`,
    rawResponse: {
      current: current.rawResponse,
      baseline: baseline?.rawResponse ?? null,
      endpoints: {
        current: current.endpoint,
        baseline: baseline?.endpoint ?? null,
      },
      notes:
        "Growth = percent change between ACS 5-Year vintages. Periods overlap; treat as multi-year trend, not YoY.",
    },
  };
}

export async function upsertOpportunityMarketIdentity(
  db: Client,
  def: OpportunityMarketDefinition,
): Promise<string> {
  const primaryState = def.states[0] ?? null;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.markets (
      market_name,
      market_slug,
      market_type,
      cbsa_code,
      state,
      states,
      timezone,
      center_lat,
      center_lng,
      opportunity_enabled,
      updated_at
    ) values (
      $1, $2, $3, $4, $5, $6::text[], $7, $8, $9, true, now()
    )
    on conflict (market_slug) do update set
      market_name = excluded.market_name,
      market_type = coalesce(excluded.market_type, public.markets.market_type),
      cbsa_code = coalesce(excluded.cbsa_code, public.markets.cbsa_code),
      state = coalesce(excluded.state, public.markets.state),
      states = excluded.states,
      timezone = coalesce(excluded.timezone, public.markets.timezone),
      center_lat = excluded.center_lat,
      center_lng = excluded.center_lng,
      opportunity_enabled = true,
      updated_at = now()
    returning id`,
    [
      def.name,
      def.slug,
      def.marketType,
      def.cbsaCode ?? null,
      primaryState,
      def.states,
      def.timezone,
      def.center.lat,
      def.center.lng,
    ],
  );
  return rows[0]!.id;
}

export async function replaceMarketLocalities(
  db: Client,
  marketId: string,
  def: OpportunityMarketDefinition,
): Promise<number> {
  await db.query(`delete from public.market_localities where market_id = $1`, [
    marketId,
  ]);

  let inserted = 0;
  for (let i = 0; i < def.localities.length; i++) {
    const loc = def.localities[i]!;
    await db.query(
      `insert into public.market_localities (
        market_id, city_name, state, latitude, longitude, zoom, sort_order, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, now())
      on conflict (market_id, city_name, state) do update set
        latitude = excluded.latitude,
        longitude = excluded.longitude,
        zoom = excluded.zoom,
        sort_order = excluded.sort_order,
        updated_at = now()`,
      [
        marketId,
        loc.city,
        loc.state,
        loc.lat,
        loc.lng,
        loc.zoom ?? 13,
        i,
      ],
    );
    inserted += 1;
  }
  return inserted;
}

export async function applyOpportunityCensusStats(
  db: Client,
  marketSlug: string,
  stats: OpportunityMarketStats,
): Promise<void> {
  await db.query(
    `update public.markets set
      cbsa_code = $2,
      geography_name = $3,
      population = $4,
      households = $5,
      housing_units = $6,
      owner_occupied_units = $7,
      owner_occupied_rate = $8,
      owner_occupied_per_1k_residents = $9,
      median_household_income = $10,
      median_home_value = $11,
      median_year_structure_built = $12,
      single_family_detached_units = $13,
      single_family_share = $14,
      population_growth = $15,
      household_growth = $16,
      housing_growth = $17,
      dataset_year = $18,
      baseline_dataset_year = $19,
      data_source = $20,
      raw_response = $21::jsonb,
      last_updated = now(),
      updated_at = now()
    where market_slug = $1`,
    [
      marketSlug,
      stats.cbsaCode,
      stats.geographyName,
      stats.population,
      stats.households,
      stats.housingUnits,
      stats.ownerOccupiedUnits,
      stats.ownerOccupiedRate,
      stats.ownerOccupiedPer1kResidents,
      stats.medianHouseholdIncome,
      stats.medianHomeValue,
      stats.medianYearStructureBuilt,
      stats.singleFamilyDetachedUnits,
      stats.singleFamilyShare,
      stats.populationGrowth,
      stats.householdGrowth,
      stats.housingGrowth,
      stats.datasetYear,
      stats.baselineDatasetYear,
      stats.dataSource,
      JSON.stringify(stats.rawResponse),
    ],
  );
}

/** Keep legacy MarketAcsStats path available for Boise-only enrich. */
export async function fetchCurrentMarketAcs(
  cbsaCode: string,
  apiKey: string,
): Promise<MarketAcsStats> {
  return fetchMarketAcsByCbsa({ cbsaCode, apiKey });
}

void CENSUS_ACS_BASE;
void OPPORTUNITY_ACS_EXTRA_VARS;
