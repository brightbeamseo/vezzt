/**
 * Import full Google review history for one business via Apify Reviews Scraper.
 *
 * Usage: npm run enrich:reviews -- <business-id>
 *
 * Optional env:
 *   APIFY_REVIEWS_RUN_ID — reuse an existing finished/running Apify run
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import { calculateReviewAnalytics } from "../src/lib/review-analytics";
import {
  REVIEWS_ACTOR_ID,
  scrapeGoogleReviews,
} from "../src/lib/reviews-apify";
import { upsertReviews } from "../src/lib/reviews-import";

config({ path: ".env.local" });

function round(n: number | null, digits = 2): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

async function main() {
  const businessId = process.argv[2]?.trim();
  if (!businessId) {
    console.error("Usage: npm run enrich:reviews -- <business-id>");
    process.exit(1);
  }

  const existingRunId = process.env.APIFY_REVIEWS_RUN_ID?.trim() || undefined;
  const db = await connectAdminPg();

  try {
    const bizRes = await db.query<{
      id: string;
      name: string;
      google_place_id: string | null;
    }>(
      `select id, name, google_place_id from public.businesses where id = $1`,
      [businessId],
    );
    const biz = bizRes.rows[0];
    if (!biz) {
      throw new Error(`Business not found: ${businessId}`);
    }
    if (!biz.google_place_id) {
      throw new Error(`Business ${biz.name} has no google_place_id`);
    }

    console.log(`Business: ${biz.name}`);
    console.log(`Place ID: ${biz.google_place_id}`);
    console.log(`Actor:   ${REVIEWS_ACTOR_ID}`);
    if (existingRunId) {
      console.log(`Reusing Apify run: ${existingRunId}`);
    } else {
      console.log("Starting Apify Google Maps Reviews Scraper…");
    }

    const scrape = await scrapeGoogleReviews({
      placeId: biz.google_place_id,
      existingRunId,
    });

    console.log(`Run ID:     ${scrape.runId}`);
    console.log(`Dataset ID: ${scrape.datasetId}`);
    console.log(`Status:     ${scrape.status}`);
    console.log(
      `Apify cost: ${
        scrape.usageTotalUsd === null
          ? "unknown"
          : `$${scrape.usageTotalUsd.toFixed(4)}`
      }`,
    );
    if (scrape.chargedEventCounts) {
      console.log(
        `Charged events: ${JSON.stringify(scrape.chargedEventCounts)}`,
      );
    }
    console.log(`Dataset rows: ${scrape.items.length}`);

    const importStats = await upsertReviews(
      db,
      scrape.items,
      biz.id,
      biz.google_place_id,
    );

    console.log("Import:");
    console.log(`  unique reviews: ${importStats.uniqueReviews}`);
    console.log(`  created:        ${importStats.created}`);
    console.log(`  updated:        ${importStats.updated}`);
    console.log(`  skipped:        ${importStats.skipped}`);
    console.log(`  failed:         ${importStats.failed}`);
    if (importStats.failures.length) {
      console.log(
        `  first failures: ${JSON.stringify(importStats.failures.slice(0, 5))}`,
      );
    }

    const stored = await db.query<{
      published_at: Date;
      rating: string | null;
      owner_response_text: string | null;
      owner_response_date: Date | null;
    }>(
      `select published_at, rating, owner_response_text, owner_response_date
       from public.reviews
       where business_id = $1
       order by published_at asc`,
      [biz.id],
    );

    const analytics = calculateReviewAnalytics(
      stored.rows.map((r) => ({
        publishedAt: new Date(r.published_at),
        rating: r.rating === null ? null : Number(r.rating),
        ownerResponseText: r.owner_response_text,
        ownerResponseDate: r.owner_response_date
          ? new Date(r.owner_response_date)
          : null,
      })),
    );

    const snap = await db.query<{ review_count: number | null }>(
      `select review_count
       from public.review_snapshots
       where business_id = $1
       order by snapshot_date desc, created_at desc
       limit 1`,
      [biz.id],
    );
    const googleCount = snap.rows[0]?.review_count ?? null;
    const mismatch =
      googleCount === null
        ? null
        : googleCount - analytics.totalImportedReviews;

    console.log("\n=== Review history report ===");
    console.log(
      JSON.stringify(
        {
          actor: REVIEWS_ACTOR_ID,
          apifyCostUsd: scrape.usageTotalUsd,
          runId: scrape.runId,
          datasetId: scrape.datasetId,
          reviewsReturned: scrape.items.length,
          uniqueReviewsImported: analytics.totalImportedReviews,
          duplicatesSkipped:
            importStats.uniqueReviews -
            (importStats.created + importStats.updated) +
            (scrape.items.length - importStats.uniqueReviews),
          datasetRowsMinusUnique:
            scrape.items.length - importStats.uniqueReviews,
          created: importStats.created,
          updated: importStats.updated,
          skipped: importStats.skipped,
          failed: importStats.failed,
          earliestReviewDate: analytics.earliestReviewDate,
          latestReviewDate: analytics.latestReviewDate,
          reviewsLast30Days: analytics.reviewsLast30Days,
          reviewsLast90Days: analytics.reviewsLast90Days,
          reviewsLast365Days: analytics.reviewsLast365Days,
          current90DayMonthlyVelocity: round(
            analytics.current90DayMonthlyVelocity,
          ),
          prior90DayMonthlyVelocity: round(
            analytics.prior90DayMonthlyVelocity,
          ),
          reviewMomentumPct: round(analytics.reviewMomentumPct, 1),
          ownerResponseRate: round(
            analytics.ownerResponseRate === null
              ? null
              : analytics.ownerResponseRate * 100,
            1,
          ),
          medianOwnerResponseHours: round(
            analytics.medianOwnerResponseHours,
            1,
          ),
          googleReviewCountSnapshot: googleCount,
          mismatchVsGoogleCount: mismatch,
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
