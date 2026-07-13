/**
 * Re-qualify businesses (roofing MVP rules + review threshold).
 * Usage:
 *   tsx scripts/qualify-businesses.ts
 *   tsx scripts/qualify-businesses.ts --threshold=50
 *   tsx scripts/qualify-businesses.ts --source=google_apify
 */
import { writeFileSync } from "node:fs";
import {
  DEFAULT_REVIEW_THRESHOLD,
  qualifyRoofingBusiness,
  type QualificationStatus,
} from "../src/lib/qualification";
import { connectSupabasePg } from "./db";

type Row = {
  id: string;
  name: string;
  primary_category: string | null;
  secondary_categories: string[] | null;
  website_url: string | null;
  review_count: number | null;
  google_place_id: string | null;
};

type ReportRow = {
  id: string;
  name: string;
  primaryCategory: string | null;
  reviewCount: number | null;
  status: QualificationStatus;
  reason: string;
  confidence: number;
  borderline: boolean;
};

function parseArgs(argv: string[]) {
  let threshold = Number(
    process.env.VEZZT_MIN_REVIEW_COUNT ?? DEFAULT_REVIEW_THRESHOLD,
  );
  let source: string | null = "google_apify";

  for (const arg of argv) {
    if (arg.startsWith("--threshold=")) {
      threshold = Number(arg.split("=")[1]);
    }
    if (arg === "--all") {
      source = null;
    }
    if (arg.startsWith("--source=")) {
      source = arg.split("=")[1];
    }
  }

  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error("Invalid --threshold");
  }

  return { threshold, source };
}

async function main() {
  const { threshold, source } = parseArgs(process.argv.slice(2));
  const client = await connectSupabasePg();

  try {
    const { rows } = await client.query<Row>(
      `
      select
        b.id,
        b.name,
        b.primary_category,
        b.secondary_categories,
        b.website_url,
        b.google_place_id,
        (
          select rs.review_count
          from public.review_snapshots rs
          where rs.business_id = b.id
          order by rs.snapshot_date desc
          limit 1
        ) as review_count
      from public.businesses b
      where ($1::text is null)
         or exists (
           select 1
           from public.review_snapshots rs
           where rs.business_id = b.id
             and rs.source = $1
         )
      order by b.name
      `,
      [source],
    );

    const report = {
      threshold,
      source,
      processed: rows.length,
      qualified: [] as ReportRow[],
      belowThreshold: [] as ReportRow[],
      excluded: [] as ReportRow[],
      manualReview: [] as ReportRow[],
      borderline: [] as ReportRow[],
    };

    await client.query("begin");

    for (const row of rows) {
      const result = qualifyRoofingBusiness(
        {
          name: row.name,
          primaryCategory: row.primary_category,
          secondaryCategories: row.secondary_categories,
          websiteUrl: row.website_url,
          reviewCount: row.review_count,
        },
        threshold,
      );

      await client.query(
        `
        update public.businesses set
          is_qualified = $2,
          qualification_reason = $3,
          qualification_confidence = $4,
          target_sector = $5,
          review_threshold_met = $6,
          qualification_status = $7,
          updated_at = now()
        where id = $1
        `,
        [
          row.id,
          result.isQualified,
          result.qualificationReason,
          result.qualificationConfidence,
          result.targetSector,
          result.reviewThresholdMet,
          result.qualificationStatus,
        ],
      );

      const entry: ReportRow = {
        id: row.id,
        name: row.name,
        primaryCategory: row.primary_category,
        reviewCount: row.review_count,
        status: result.qualificationStatus,
        reason: result.qualificationReason,
        confidence: result.qualificationConfidence,
        borderline: result.borderline,
      };

      if (result.qualificationStatus === "qualified") {
        report.qualified.push(entry);
      } else if (result.qualificationStatus === "below_threshold") {
        report.belowThreshold.push(entry);
      } else if (result.qualificationStatus === "manual_review") {
        report.manualReview.push(entry);
      } else {
        report.excluded.push(entry);
      }

      if (result.borderline) {
        report.borderline.push(entry);
      }
    }

    await client.query("commit");

    const outPath = "tmp/boise-roofing-qualification-report.json";
    writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log(
      JSON.stringify(
        {
          threshold: report.threshold,
          source: report.source,
          processed: report.processed,
          counts: {
            qualified: report.qualified.length,
            below_threshold: report.belowThreshold.length,
            excluded: report.excluded.length,
            manual_review: report.manualReview.length,
            borderline: report.borderline.length,
          },
          qualified: report.qualified.map((r) => ({
            name: r.name,
            category: r.primaryCategory,
            reviews: r.reviewCount,
            reason: r.reason,
          })),
          excluded: report.excluded.map((r) => ({
            name: r.name,
            category: r.primaryCategory,
            reviews: r.reviewCount,
            reason: r.reason,
          })),
          below_threshold: report.belowThreshold.map((r) => ({
            name: r.name,
            category: r.primaryCategory,
            reviews: r.reviewCount,
            reason: r.reason,
          })),
          manual_review_borderline: report.manualReview.map((r) => ({
            name: r.name,
            category: r.primaryCategory,
            reviews: r.reviewCount,
            reason: r.reason,
          })),
          reportPath: outPath,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
