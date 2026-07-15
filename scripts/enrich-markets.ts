/**
 * Market Census enrichment CLI.
 *
 * Usage: npm run enrich:markets
 *
 * When CENSUS_API_KEY is missing: print message and exit 0.
 * When present: resolve Boise CBSA from Census geography, fetch ACS 5-Year
 * Detailed Tables, and update the existing Boise Metro markets row.
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  CENSUS_API_KEY_CLI_MISSING_MESSAGE,
  CENSUS_API_KEY_MISSING_MESSAGE,
  enrichMarketFromCensus,
  ensureCodeMarketsSeeded,
  fetchMarket,
  isCensusApiKeyConfigured,
} from "../src/lib/census/market-enrichment";

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

  const db = await connectAdminPg();
  try {
    await ensureCodeMarketsSeeded(db);

    const before = await fetchMarket(db, "boise-metro");
    if (!before) {
      throw new Error("Boise Metro market row missing after seed");
    }

    const { market, resolved, stats } = await enrichMarketFromCensus({
      db,
      marketSlug: "boise-metro",
      // Verified against Census NAME listing — not hard-coded CBSA.
      nameIncludes: ["boise city", "id"],
    });

    const linked = await db.query<{
      total: number;
      same_market: number;
      distinct_market_ids: number;
    }>(
      `select
         count(*)::int as total,
         count(*) filter (where b.market_id = $1::uuid)::int as same_market,
         count(distinct b.market_id)::int as distinct_market_ids
       from public.businesses b
       where b.target_sector = 'roofing'
         and b.market_id is not null`,
      [market.id],
    );

    const marketCount = await db.query<{ n: number }>(
      `select count(*)::int as n from public.markets where market_slug = 'boise-metro'`,
    );

    console.log(
      JSON.stringify(
        {
          verifiedCbsaCode: resolved.cbsaCode,
          censusName: resolved.name,
          cbsaCandidates: resolved.candidates,
          geographyEndpoint: resolved.endpoint,
          geographyHttpStatus: resolved.httpStatus,
          acsEndpoint: stats.endpoint,
          acsHttpStatus: stats.httpStatus,
          marketRowUpdated: {
            id: market.id,
            marketSlug: market.marketSlug,
            marketName: market.marketName,
            cbsaCode: market.cbsaCode,
            population: market.population,
            households: market.households,
            housingUnits: market.housingUnits,
            ownerOccupiedUnits: market.ownerOccupiedUnits,
            ownerOccupiedRate: market.ownerOccupiedRate,
            medianHouseholdIncome: market.medianHouseholdIncome,
            medianHomeValue: market.medianHomeValue,
            medianYearStructureBuilt: market.medianYearStructureBuilt,
            datasetYear: market.datasetYear,
            dataSource: market.dataSource,
            lastUpdated: market.lastUpdated,
          },
          boiseMetroRowCount: marketCount.rows[0]?.n ?? 0,
          businessesLinked: linked.rows[0],
          priorMarketId: before.id,
          marketIdUnchanged: before.id === market.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
