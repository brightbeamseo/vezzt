/**
 * One-business Ahrefs enrichment for Point Roofing & Restoration.
 * Uses businesses.analysis_target + analysis_mode from the database.
 *
 * Usage:
 *   npm run enrich:point-roofing-ahrefs
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import { fetchAhrefsByAnalysis, fetchAhrefsUsage } from "../src/lib/ahrefs";
import type { AnalysisMode } from "../src/lib/companies";
import { insertSeoSnapshot } from "../src/lib/seo-snapshots";

config({ path: ".env.local" });

const POINT_ROOFING_BUSINESS_ID = "fd5fac35-36a2-47dc-96bf-0bcec6b3ed0f";

async function main() {
  const db = await connectAdminPg();
  let business: {
    id: string;
    name: string;
    analysis_target: string | null;
    analysis_mode: AnalysisMode | null;
  };
  try {
    const { rows } = await db.query<{
      id: string;
      name: string;
      analysis_target: string | null;
      analysis_mode: AnalysisMode | null;
    }>(
      `select id, name, analysis_target, analysis_mode
       from public.businesses
       where id = $1`,
      [POINT_ROOFING_BUSINESS_ID],
    );
    if (!rows[0]) {
      throw new Error(`Business not found: ${POINT_ROOFING_BUSINESS_ID}`);
    }
    business = rows[0];
  } finally {
    await db.end();
  }

  if (!business.analysis_target || !business.analysis_mode) {
    throw new Error(
      `Missing analysis_target/analysis_mode for ${business.name}. Run npm run backfill:companies first.`,
    );
  }

  console.log(
    `Business: ${business.name} (${business.id}) target=${business.analysis_target} mode=${business.analysis_mode}`,
  );

  const usageBefore = await fetchAhrefsUsage();
  const result = await fetchAhrefsByAnalysis({
    analysisTarget: business.analysis_target,
    analysisMode: business.analysis_mode,
  });
  const usageAfter = await fetchAhrefsUsage();

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const snapshot = await insertSeoSnapshot({
    businessId: POINT_ROOFING_BUSINESS_ID,
    domain: result.metrics.domain,
    snapshotDate,
    metrics: result.metrics,
    rawResponse: {
      endpoint: result.endpoint,
      analysisTarget: result.analysisTarget,
      analysisMode: result.analysisMode,
      unitsCost: result.unitsCost,
      fetchedAt: new Date().toISOString(),
      usageBefore,
      usageAfter,
      ahrefs: result.rawResponse,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        analysisTarget: result.analysisTarget,
        analysisMode: result.analysisMode,
        endpoint: result.endpoint,
        unitsCost: result.unitsCost,
        metrics: result.metrics,
        snapshot: {
          id: snapshot.id,
          domain: snapshot.domain,
          snapshotDate: snapshot.snapshotDate,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
