/**
 * Market Census enrichment CLI.
 *
 * Architecture only — does not call Census APIs yet.
 * When CENSUS_API_KEY is missing: print message and exit 0.
 *
 * Usage: npm run enrich:markets
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  CENSUS_API_KEY_CLI_MISSING_MESSAGE,
  CENSUS_API_KEY_MISSING_MESSAGE,
  ensureCodeMarketsSeeded,
  fetchMarket,
  isCensusApiKeyConfigured,
} from "../src/lib/census/market-enrichment";
import { MARKETS } from "../src/lib/markets";

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

    const markets = [];
    for (const slug of Object.keys(MARKETS)) {
      const row = await fetchMarket(db, slug);
      markets.push(
        row
          ? {
              id: row.id,
              marketSlug: row.marketSlug,
              marketName: row.marketName,
              population: row.population,
              medianHouseholdIncome: row.medianHouseholdIncome,
              datasetYear: row.datasetYear,
              lastUpdated: row.lastUpdated,
            }
          : { marketSlug: slug, missing: true },
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "ready",
          message:
            "CENSUS_API_KEY present, but market Census API fetch is not implemented yet. Markets are seeded; statistics remain null until fetchMarket is wired.",
          markets,
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
