/**
 * Build a discovery summary report from the latest import + DB state.
 * Usage: tsx scripts/discovery-report.ts --market=boise-metro [--meta=tmp/...-meta.json]
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { config } from "dotenv";
import { getMarket } from "../src/lib/markets";
import { connectSupabasePg } from "./db";

config({ path: ".env.local" });

function findLatestMeta(marketId: string): string | null {
  const files = readdirSync("tmp")
    .filter(
      (f) =>
        f.startsWith(`${marketId}-roofing-discovery-`) && f.endsWith("-meta.json"),
    )
    .sort()
    .reverse();
  return files[0] ? `tmp/${files[0]}` : null;
}

async function main() {
  const marketId =
    process.argv.find((a) => a.startsWith("--market="))?.split("=")[1] ??
    "boise-metro";
  const metaPath =
    process.argv.find((a) => a.startsWith("--meta="))?.slice("--meta=".length) ??
    findLatestMeta(marketId);

  const market = getMarket(marketId);
  const meta = metaPath
    ? (JSON.parse(readFileSync(metaPath, "utf8")) as {
        placesReturnedRaw: number;
        placesReturnedDeduped: number;
        estimatedDiscoveryCostUsd: number;
        runs: { usageTotalUsd: number | null }[];
      })
    : null;

  const client = await connectSupabasePg();
  try {
    const roofing = await client.query<{
      id: string;
      name: string;
      city: string | null;
      review_count: number | null;
      monitoring_tier: number | null;
      qualification_status: string;
      qualification_reason: string | null;
    }>(
      `
      select b.id, b.name, b.city, b.monitoring_tier, b.qualification_status,
             b.qualification_reason,
             (
               select rs.review_count from review_snapshots rs
               where rs.business_id = b.id
               order by rs.snapshot_date desc limit 1
             ) as review_count
      from businesses b
      join markets m on m.id = b.market_id
      where m.market_slug = $1
        and b.target_sector = 'roofing'
        and b.qualification_status in ('qualified', 'below_threshold', 'manual_review')
      order by coalesce(
               (
                 select rs.review_count from review_snapshots rs
                 where rs.business_id = b.id
                 order by rs.snapshot_date desc limit 1
               ), 0) desc, b.name
      `,
      [market.id],
    );

    const excluded = await client.query<{
      name: string;
      city: string | null;
      qualification_reason: string | null;
    }>(
      `select b.name, b.city, b.qualification_reason
       from businesses b
       join markets m on m.id = b.market_id
       where m.market_slug = $1 and b.qualification_status = 'excluded'
       order by b.name`,
      [market.id],
    );

    const marketRejects = await client.query<{
      name: string | null;
      city: string | null;
      reason: string;
    }>(
      `select name, city, reason from collection_rejections
       where market_id = $1 and rejection_stage = 'market'
       order by created_at desc
       limit 500`,
      [market.id],
    );

    const tier1 = roofing.rows.filter((r) => (r.review_count ?? 0) >= 100);
    const tier2 = roofing.rows.filter((r) => (r.review_count ?? 0) < 100);

    // Cost model from last full discovery: usd per unique place (~place detail)
    const discoveryUsd = meta?.estimatedDiscoveryCostUsd ?? null;
    const uniquePlaces = meta?.placesReturnedDeduped ?? null;
    const usdPerPlace =
      discoveryUsd && uniquePlaces
        ? discoveryUsd / Math.max(uniquePlaces, 1)
        : 0.006; // fallback from earlier pilot (~$0.15 / 25)

    const weeklyTier1Cost = tier1.length * usdPerPlace;

    const report = {
      marketId: market.id,
      generatedAt: new Date().toISOString(),
      discovery: {
        totalRawApifyResults: meta?.placesReturnedRaw ?? null,
        uniquePlaceIds: meta?.placesReturnedDeduped ?? null,
        discoveryCostUsd: discoveryUsd,
        usdPerPlaceEstimate: Number(usdPerPlace.toFixed(6)),
        metaPath,
      },
      qualifiedRoofingCompanies: roofing.rows.length,
      businessesWith100PlusReviews: {
        count: tier1.length,
        businesses: tier1.map((r) => ({
          name: r.name,
          city: r.city,
          reviews: r.review_count,
        })),
      },
      businessesBelow100ReviewsMonthly: {
        count: tier2.length,
        businesses: tier2.map((r) => ({
          name: r.name,
          city: r.city,
          reviews: r.review_count,
        })),
      },
      excludedBusinesses: {
        count: excluded.rows.length,
        businesses: excluded.rows,
      },
      outsideMarket: {
        count: marketRejects.rows.length,
        businesses: marketRejects.rows,
      },
      estimatedWeeklyTier1MonitoringCostUsd: Number(weeklyTier1Cost.toFixed(4)),
      notes: [
        "Qualification: primary category must be exactly Roofing contractor.",
        "Tier 1 (100+ reviews): weekly Place-ID monitoring via Vercel Cron.",
        "Tier 2 (<100 reviews): monthly Place-ID monitoring via Vercel Cron.",
        "Market discovery: Apify monthly map startUrls (100/city) — not locationQuery or weekly broad search.",
        "Uniqueness: google_place_id / placeId.",
        "Velocity metrics require 2+ snapshots — not fabricated after a single discovery pass.",
        "Vestimates not calculated.",
      ],
    };

    const out = `tmp/${market.id}-discovery-summary.json`;
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    console.log(`Wrote ${out}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
