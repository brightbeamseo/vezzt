/**
 * Bulk Ahrefs SEO enrichment for qualified Boise Metro roofers (100+ reviews).
 * Uses businesses.analysis_target + analysis_mode (not always root domain).
 *
 * Usage:
 *   npm run enrich:boise-roofing-ahrefs
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  fetchAhrefsAnalysisTargets,
  fetchAhrefsUsage,
} from "../src/lib/ahrefs";
import type { AnalysisMode } from "../src/lib/companies";
import { getMarket, normalizeCityName } from "../src/lib/markets";
import { insertSeoSnapshot } from "../src/lib/seo-snapshots";

config({ path: ".env.local" });

type Candidate = {
  id: string;
  name: string;
  city: string | null;
  website_url: string | null;
  analysis_target: string | null;
  analysis_mode: AnalysisMode | null;
  review_count: number | null;
};

function usageUnits(payload: unknown): number | null {
  const units = (
    payload as { limits_and_usage?: { units_usage_workspace?: number } } | null
  )?.limits_and_usage?.units_usage_workspace;
  return typeof units === "number" && Number.isFinite(units) ? units : null;
}

async function main() {
  const market = getMarket("boise-metro");
  const allowedCities = new Set(market.cities.map(normalizeCityName));
  const db = await connectAdminPg();

  let candidates: Candidate[];
  try {
    const { rows } = await db.query<Candidate>(`
      select
        b.id,
        b.name,
        b.city,
        b.website_url,
        b.analysis_target,
        b.analysis_mode,
        latest.review_count
      from public.businesses b
      left join lateral (
        select rs.review_count
        from public.review_snapshots rs
        where rs.business_id = b.id
        order by rs.snapshot_date desc, rs.created_at desc
        limit 1
      ) latest on true
      where b.qualification_status = 'qualified'
        and b.primary_category = 'Roofing contractor'
        and coalesce(latest.review_count, 0) >= 100
      order by latest.review_count desc nulls last, b.name asc
    `);
    candidates = rows.filter(
      (row) => row.city && allowedCities.has(normalizeCityName(row.city)),
    );
  } finally {
    await db.end();
  }

  const skippedMissingTarget = candidates.filter(
    (c) => !c.analysis_target || !c.analysis_mode,
  );
  const ready = candidates.filter((c) => c.analysis_target && c.analysis_mode);

  console.log(
    JSON.stringify(
      {
        selected: candidates.length,
        ready: ready.length,
        skippedMissingTarget: skippedMissingTarget.map((c) => ({
          id: c.id,
          name: c.name,
          website: c.website_url,
        })),
        businesses: ready.map((c) => ({
          id: c.id,
          name: c.name,
          analysisTarget: c.analysis_target,
          analysisMode: c.analysis_mode,
        })),
      },
      null,
      2,
    ),
  );

  if (ready.length === 0) {
    console.log(
      JSON.stringify({
        ok: true,
        message: "No businesses with analysis targets to enrich.",
        successful: 0,
        failed: 0,
        skippedMissingTarget: skippedMissingTarget.length,
        snapshotsInserted: 0,
      }),
    );
    return;
  }

  const usageBeforeRaw = await fetchAhrefsUsage();
  const unitsBefore = usageUnits(usageBeforeRaw);

  const batch = await fetchAhrefsAnalysisTargets(
    ready.map((c) => ({
      analysisTarget: c.analysis_target!,
      analysisMode: c.analysis_mode!,
    })),
  );

  const usageAfterRaw = await fetchAhrefsUsage();
  const unitsAfter = usageUnits(usageAfterRaw);
  const totalUnitsConsumed =
    unitsBefore !== null && unitsAfter !== null && unitsAfter > unitsBefore
      ? unitsAfter - unitsBefore
      : (batch.unitsCost ?? 0);

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const successes: unknown[] = [];
  const failures: unknown[] = [];

  for (const business of ready) {
    const metrics = batch.byTarget.get(business.analysis_target!);
    if (!metrics) {
      failures.push({
        businessId: business.id,
        name: business.name,
        analysisTarget: business.analysis_target,
        error: "No Ahrefs row returned for analysis target",
      });
      continue;
    }

    try {
      const snapshot = await insertSeoSnapshot({
        businessId: business.id,
        domain: metrics.domain,
        snapshotDate,
        metrics,
        rawResponse: {
          endpoint: batch.endpoint,
          analysisTarget: business.analysis_target,
          analysisMode: business.analysis_mode,
          unitsCostBatch: batch.unitsCost,
          fetchedAt: new Date().toISOString(),
          usageBefore: usageBeforeRaw,
          usageAfter: usageAfterRaw,
          ahrefsBatch: batch.rawResponse,
        },
      });

      successes.push({
        name: business.name,
        analysisTarget: business.analysis_target,
        analysisMode: business.analysis_mode,
        domain: snapshot.domain,
        domainRating: snapshot.domainRating,
        organicTraffic: snapshot.organicTraffic,
        snapshotId: snapshot.id,
      });
    } catch (error) {
      failures.push({
        businessId: business.id,
        name: business.name,
        analysisTarget: business.analysis_target,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        endpoint: batch.endpoint,
        unitsHeader: batch.unitsCost,
        totalUnitsConsumed,
        successful: successes.length,
        failed: failures.length,
        skippedMissingTarget: skippedMissingTarget.length,
        snapshotsInserted: successes.length,
        failures,
        results: successes,
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
