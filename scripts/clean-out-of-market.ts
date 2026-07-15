/**
 * Remove businesses outside a market city allowlist.
 * Usage: tsx scripts/clean-out-of-market.ts --market=boise-metro [--dry-run]
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { resolveMarketUuid } from "../src/lib/census/market-enrichment";
import { getMarket, isInMarket } from "../src/lib/markets";
import { connectSupabasePg } from "./db";

config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const marketArg = args.find((a) => a.startsWith("--market="))?.split("=")[1];
  const dryRun = args.includes("--dry-run");
  if (!marketArg) {
    throw new Error("Usage: tsx scripts/clean-out-of-market.ts --market=boise-metro");
  }

  const market = getMarket(marketArg);
  const client = await connectSupabasePg();
  const marketUuid = await resolveMarketUuid(client, market.id);

  try {
    const { rows } = await client.query<{
      id: string;
      name: string;
      city: string | null;
      state: string | null;
      market_id: string | null;
      google_place_id: string | null;
    }>(
      `select id, name, city, state, market_id, google_place_id from public.businesses order by name`,
    );

    const keep: typeof rows = [];
    const remove: { id: string; name: string; city: string | null; reason: string }[] =
      [];

    for (const row of rows) {
      const check = isInMarket(market, { city: row.city });
      if (check.ok) {
        keep.push(row);
      } else {
        remove.push({
          id: row.id,
          name: row.name,
          city: row.city,
          reason: check.reason,
        });
      }
    }

    if (!dryRun && remove.length) {
      await client.query("begin");
      const ids = remove.map((r) => r.id);
      await client.query(`delete from public.businesses where id = any($1::uuid[])`, [
        ids,
      ]);
      // Tag keepers with market_id
      await client.query(
        `update public.businesses set market_id = $1::uuid, updated_at = now()
         where city is not null
           and lower(trim(city)) = any($2::text[])`,
        [marketUuid, market.cities.map((c) => c.toLowerCase())],
      );
      await client.query("commit");
    } else if (!dryRun) {
      await client.query(
        `update public.businesses set market_id = $1::uuid, updated_at = now()
         where city is not null
           and lower(trim(city)) = any($2::text[])`,
        [marketUuid, market.cities.map((c) => c.toLowerCase())],
      );
    }

    const report = {
      market: market.id,
      dryRun,
      kept: keep.length,
      removed: remove.length,
      removedBusinesses: remove,
      keptCities: [...new Set(keep.map((k) => k.city).filter(Boolean))],
    };

    writeFileSync(
      `tmp/${market.id}-clean-report.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
