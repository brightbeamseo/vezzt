/**
 * Unified Census enrichment for markets + ZIPs.
 *
 * 1. Seed / update configured markets (ACS 5-Year CBSA)
 * 2. Link Boise Metro businesses via market_id
 * 3. Upsert zip_code_stats for ZIPs used by Boise Metro roofing businesses
 *
 * Usage: npm run enrich:census
 *
 * Requires CENSUS_API_KEY in .env.local (server-side only).
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  CENSUS_API_KEY_CLI_MISSING_MESSAGE,
  CENSUS_API_KEY_MISSING_MESSAGE,
  CENSUS_DATA_SOURCE,
  CENSUS_DATASET_NAME,
  CENSUS_DATASET_YEAR,
  enrichMarketFromCensus,
  ensureCodeMarketsSeeded,
  fetchCensusZctaStats,
  fetchMarket,
  isCensusApiKeyConfigured,
  assignBusinessesToMarket,
  normalizeZipCode,
} from "../src/lib/census";
import { getMarket } from "../src/lib/markets";

config({ path: ".env.local" });

async function main() {
  if (!isCensusApiKeyConfigured()) {
    console.log(CENSUS_API_KEY_CLI_MISSING_MESSAGE);
    console.log(CENSUS_API_KEY_MISSING_MESSAGE);
    console.log(
      "Enrichment disabled. Add CENSUS_API_KEY to .env.local then re-run.",
    );
    process.exit(0);
  }

  const apiKey = process.env.CENSUS_API_KEY!.trim();
  const marketDef = getMarket("boise-metro");
  const db = await connectAdminPg();

  let censusRequests = 0;
  const failures: { step: string; error: string }[] = [];

  try {
    await ensureCodeMarketsSeeded(db);

    // --- Markets ---
    let marketsUpdated = 0;
    let marketRow: Awaited<ReturnType<typeof fetchMarket>> = null;
    let acsEndpoint: string | null = null;
    let geographyEndpoint: string | null = null;

    try {
      const { market, resolved, stats } = await enrichMarketFromCensus({
        db,
        marketSlug: "boise-metro",
        nameIncludes: ["boise city", "id"],
      });
      marketRow = market;
      marketsUpdated = 1;
      censusRequests += 2; // geography resolve + ACS CBSA
      acsEndpoint = stats.endpoint;
      geographyEndpoint = resolved.endpoint;
    } catch (err) {
      failures.push({
        step: "enrich_market_boise_metro",
        error: err instanceof Error ? err.message : String(err),
      });
    }

    if (!marketRow) {
      marketRow = await fetchMarket(db, "boise-metro");
    }
    if (!marketRow) {
      throw new Error("Boise Metro market row missing after seed/enrich");
    }

    // --- Link businesses ---
    const linked = await assignBusinessesToMarket(db, {
      marketId: marketRow.id,
      targetSector: "roofing",
      cities: marketDef.cities,
    });

    const linkStats = await db.query<{
      total_in_market: number;
      roofing_in_market: number;
      qualified_in_market: number;
    }>(
      `select
         count(*)::int as total_in_market,
         count(*) filter (where b.target_sector = 'roofing')::int as roofing_in_market,
         count(*) filter (
           where b.target_sector = 'roofing'
             and b.qualification_status = 'qualified'
         )::int as qualified_in_market
       from public.businesses b
       where b.market_id = $1::uuid`,
      [marketRow.id],
    );

    // --- ZIP codes from Boise Metro roofing businesses ---
    const { rows: zipRows } = await db.query<{ postal_code: string | null }>(
      `select distinct b.postal_code
       from public.businesses b
       where b.market_id = $1::uuid
         and b.target_sector = 'roofing'
         and b.postal_code is not null
         and trim(b.postal_code) <> ''
       order by b.postal_code`,
      [marketRow.id],
    );

    const uniqueZips = [
      ...new Set(
        zipRows
          .map((r) => normalizeZipCode(r.postal_code))
          .filter((z): z is string => Boolean(z)),
      ),
    ].sort();

    let zipsUpdated = 0;
    let missingZips: string[] = [];
    let zipErrors: Array<{ zipCodes: string[]; error: string }> = [];

    if (uniqueZips.length > 0) {
      try {
        const { matched, unavailable, errors } = await fetchCensusZctaStats({
          zipCodes: uniqueZips,
          apiKey,
        });
        // Batch fetch counts as 1+ Census requests depending on implementation
        censusRequests += Math.max(1, Math.ceil(uniqueZips.length / 50));
        missingZips = unavailable;
        zipErrors = errors;

        for (const row of matched) {
          await db.query(
            `insert into public.zip_code_stats (
              zip_code,
              population,
              households,
              housing_units,
              owner_occupied_housing_units,
              median_household_income,
              median_home_value,
              median_year_structure_built,
              owner_occupied_rate,
              data_source,
              dataset_year,
              dataset_name,
              retrieved_at,
              raw_response
            ) values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9,
              $10, $11, $12, now(), $13::jsonb
            )
            on conflict (zip_code) do update set
              population = excluded.population,
              households = excluded.households,
              housing_units = excluded.housing_units,
              owner_occupied_housing_units = excluded.owner_occupied_housing_units,
              median_household_income = excluded.median_household_income,
              median_home_value = excluded.median_home_value,
              median_year_structure_built = excluded.median_year_structure_built,
              owner_occupied_rate = excluded.owner_occupied_rate,
              data_source = excluded.data_source,
              dataset_year = excluded.dataset_year,
              dataset_name = excluded.dataset_name,
              retrieved_at = excluded.retrieved_at,
              raw_response = excluded.raw_response`,
            [
              row.zipCode,
              row.population,
              row.households,
              row.housingUnits,
              row.ownerOccupiedHousingUnits,
              row.medianHouseholdIncome,
              row.medianHomeValue,
              row.medianYearStructureBuilt,
              row.ownerOccupiedRate,
              CENSUS_DATA_SOURCE,
              CENSUS_DATASET_YEAR,
              CENSUS_DATASET_NAME,
              JSON.stringify(row.rawResponse),
            ],
          );
          zipsUpdated += 1;
        }
      } catch (err) {
        failures.push({
          step: "enrich_zips",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const report = {
      ok: failures.length === 0 && zipErrors.length === 0,
      marketsUpdated,
      zipsUpdated,
      businessesLinked: linked.updated,
      businessesInMarket: linkStats.rows[0]?.total_in_market ?? 0,
      roofingInMarket: linkStats.rows[0]?.roofing_in_market ?? 0,
      qualifiedInMarket: linkStats.rows[0]?.qualified_in_market ?? 0,
      censusRequestsMade: censusRequests,
      failures,
      missingZips,
      zipErrors,
      uniqueBusinessZips: uniqueZips.length,
      zipCodes: uniqueZips,
      endpoints: {
        geography: geographyEndpoint,
        acsCbsa: acsEndpoint,
        acsZctaBase: `https://api.census.gov/data/${CENSUS_DATASET_YEAR}/acs/acs5`,
      },
      boiseMetro: marketRow
        ? {
            id: marketRow.id,
            marketName: marketRow.marketName,
            cbsaCode: marketRow.cbsaCode,
            population: marketRow.population,
            households: marketRow.households,
            housingUnits: marketRow.housingUnits,
            ownerOccupiedUnits: marketRow.ownerOccupiedUnits,
            ownerOccupiedRate: marketRow.ownerOccupiedRate,
            medianHouseholdIncome: marketRow.medianHouseholdIncome,
            medianHomeValue: marketRow.medianHomeValue,
            medianYearStructureBuilt: marketRow.medianYearStructureBuilt,
            datasetYear: marketRow.datasetYear,
            dataSource: marketRow.dataSource,
            lastUpdated: marketRow.lastUpdated,
          }
        : null,
      notes: [
        "Metro and ZIP remain independent — neither feeds Business Strength or Vestimate.",
        "Businesses reference markets via market_id and ZIP stats via postal_code join.",
      ],
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
