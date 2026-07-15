/**
 * Recompute review velocity metrics for businesses with 2+ snapshots.
 * Usage: tsx scripts/compute-review-velocity.ts --market=boise-metro
 */
import { config } from "dotenv";
import { getMarket } from "../src/lib/markets";
import { calculateReviewVelocity } from "../src/lib/review-velocity";
import { connectSupabasePg } from "./db";

config({ path: ".env.local" });

async function main() {
  const marketId =
    process.argv.find((a) => a.startsWith("--market="))?.split("=")[1] ??
    "boise-metro";
  const market = getMarket(marketId);
  const client = await connectSupabasePg();

  try {
    const { rows } = await client.query<{ id: string }>(
      `select b.id
       from public.businesses b
       join public.markets m on m.id = b.market_id
       where m.market_slug = $1`,
      [market.id],
    );

    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
      const snaps = await client.query<{
        snapshot_date: string;
        review_count: number | null;
      }>(
        `select snapshot_date::text, review_count
         from public.review_snapshots
         where business_id = $1
         order by snapshot_date asc`,
        [row.id],
      );

      const metrics = calculateReviewVelocity(
        snaps.rows.map((s) => ({
          snapshotDate: s.snapshot_date,
          reviewCount: s.review_count,
        })),
      );

      if (metrics.insufficientHistory) {
        skipped += 1;
        continue;
      }

      await client.query(
        `insert into public.business_metrics (
          business_id,
          reviews_since_previous,
          reviews_gained_approx_30d,
          reviews_gained_approx_90d,
          avg_weekly_review_velocity,
          estimated_monthly_review_velocity,
          review_acceleration,
          updated_at
        ) values ($1,$2,$3,$4,$5,$6,$7,now())
        on conflict (business_id) do update set
          reviews_since_previous = excluded.reviews_since_previous,
          reviews_gained_approx_30d = excluded.reviews_gained_approx_30d,
          reviews_gained_approx_90d = excluded.reviews_gained_approx_90d,
          avg_weekly_review_velocity = excluded.avg_weekly_review_velocity,
          estimated_monthly_review_velocity = excluded.estimated_monthly_review_velocity,
          review_acceleration = excluded.review_acceleration,
          updated_at = now()`,
        [
          row.id,
          metrics.reviewsSincePrevious,
          metrics.reviewsGainedApprox30d,
          metrics.reviewsGainedApprox90d,
          metrics.avgWeeklyReviewVelocity,
          metrics.estimatedMonthlyReviewVelocity,
          metrics.reviewAcceleration,
        ],
      );
      updated += 1;
    }

    console.log(
      JSON.stringify(
        {
          marketId: market.id,
          businesses: rows.length,
          velocityUpdated: updated,
          insufficientHistory: skipped,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
