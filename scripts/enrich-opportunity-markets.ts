/**
 * Seed + enrich Market Opportunity candidate markets with Census ACS demographics.
 *
 * Usage: npm run enrich:opportunity-markets
 *
 * Census only — no Apify / Ahrefs / LBM / review scrapes.
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  CENSUS_API_KEY_CLI_MISSING_MESSAGE,
  CENSUS_API_KEY_MISSING_MESSAGE,
  isCensusApiKeyConfigured,
  requireCensusApiKey,
} from "../src/lib/census";
import {
  applyOpportunityCensusStats,
  buildOpportunityMarketStats,
  replaceMarketLocalities,
  resolveOpportunityCbsa,
  upsertOpportunityMarketIdentity,
} from "../src/lib/census/opportunity-enrichment";
import {
  OPPORTUNITY_MARKETS,
  OPPORTUNITY_MARKET_COUNT,
} from "../src/lib/opportunity-markets";

config({ path: ".env.local" });

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (!isCensusApiKeyConfigured()) {
    console.log(CENSUS_API_KEY_CLI_MISSING_MESSAGE);
    console.log(CENSUS_API_KEY_MISSING_MESSAGE);
    process.exit(0);
  }

  const apiKey = requireCensusApiKey();
  const db = await connectAdminPg();

  const results: Array<{
    slug: string;
    ok: boolean;
    cbsaCode?: string;
    population?: number | null;
    error?: string;
  }> = [];

  console.log(
    `Seeding + enriching ${OPPORTUNITY_MARKET_COUNT} opportunity markets…`,
  );

  try {
    for (const def of OPPORTUNITY_MARKETS) {
      try {
        const marketId = await upsertOpportunityMarketIdentity(db, def);
        await replaceMarketLocalities(db, marketId, def);

        const resolved = await resolveOpportunityCbsa(def, apiKey);
        const stats = await buildOpportunityMarketStats({
          cbsaCode: resolved.cbsaCode,
          apiKey,
        });
        await applyOpportunityCensusStats(db, def.slug, stats);

        results.push({
          slug: def.slug,
          ok: true,
          cbsaCode: stats.cbsaCode,
          population: stats.population,
        });
        console.log(
          `✓ ${def.name} (${stats.cbsaCode}) pop=${stats.population?.toLocaleString() ?? "—"} growth=${
            stats.populationGrowth == null
              ? "—"
              : `${stats.populationGrowth.toFixed(1)}%`
          }`,
        );
        await sleep(250);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ slug: def.slug, ok: false, error: message });
        console.error(`✗ ${def.slug}: ${message}`);
      }
    }
  } finally {
    await db.end();
  }

  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log("\n=== Opportunity markets enrich report ===");
  console.log(
    JSON.stringify(
      {
        totalConfigured: OPPORTUNITY_MARKET_COUNT,
        enriched: ok,
        failed: failed.length,
        failures: failed,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
