/**
 * One-shot status check for all pending/processing Boise Metro GeoGrid scans.
 * Does not poll continuously. Stores finished results into map_rank_snapshots.
 *
 * Usage: npm run check:boise-roofing-geogrid
 * Optional: npm run check:boise-roofing-geogrid -- --all
 *   (--all also re-checks finished rows' latest scan IDs for the cohort)
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import { getMarket, normalizeCityName } from "../src/lib/markets";
import { checkLbmGeogridOnce } from "../src/lib/map-rank-snapshots";

config({ path: ".env.local" });

async function main() {
  const checkAll = process.argv.includes("--all");
  const market = getMarket("boise-metro");
  const allowed = new Set(market.cities.map(normalizeCityName));
  const db = await connectAdminPg();

  let scanIds: {
    provider_scan_id: string;
    business_id: string;
    name: string;
    status: string | null;
    business_place_id: string;
  }[] = [];

  try {
    const { rows: businesses } = await db.query<{ id: string }>(`
      select b.id
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
        and b.city is not null
    `);

    const businessIds = (
      await db.query<{ id: string; city: string | null; name: string }>(
        `select id, city, name from public.businesses where id = any($1::uuid[])`,
        [businesses.map((b) => b.id)],
      )
    ).rows.filter((b) => b.city && allowed.has(normalizeCityName(b.city)));

    const ids = businessIds.map((b) => b.id);
    const nameById = new Map(businessIds.map((b) => [b.id, b.name]));

    const { rows } = await db.query<{
      provider_scan_id: string;
      business_id: string;
      status: string | null;
      business_place_id: string;
    }>(
      checkAll
        ? `select distinct on (business_id)
             provider_scan_id, business_id, status, business_place_id
           from public.map_rank_snapshots
           where business_id = any($1::uuid[])
             and provider = 'local_brand_manager'
             and search_term = 'Roofing contractor'
             and grid_size = 5
           order by business_id, coalesce(scanned_at, created_at) desc`
        : `select provider_scan_id, business_id, status, business_place_id
           from public.map_rank_snapshots
           where business_id = any($1::uuid[])
             and provider = 'local_brand_manager'
             and status in ('pending', 'processing')
           order by created_at asc`,
      [ids],
    );

    scanIds = rows.map((r) => ({
      ...r,
      name: nameById.get(r.business_id) ?? r.business_id,
    }));
  } finally {
    await db.end();
  }

  const completed: unknown[] = [];
  const pending: unknown[] = [];
  const failed: unknown[] = [];
  const unmatchedPlaceIds: unknown[] = [];

  for (const scan of scanIds) {
    try {
      const result = await checkLbmGeogridOnce(scan.provider_scan_id);
      const row = {
        name: scan.name,
        businessId: scan.business_id,
        googlePlaceId: scan.business_place_id,
        lbmScanId: scan.provider_scan_id,
        lbmState: result.lbmState,
        action: result.action,
        message: result.message,
        solv: result.snapshot?.shareOfLocalVoice ?? null,
        agr: result.snapshot?.averageGridRank ?? null,
        atgr: result.snapshot?.averageTotalGridRank ?? null,
        top3: result.snapshot?.foundInTop3Count ?? null,
        top10: result.snapshot?.foundInTop10Count ?? null,
      };

      if (result.action === "stored") completed.push(row);
      else if (result.action === "failed") failed.push(row);
      else pending.push(row);

      if (
        result.action === "stored" &&
        result.snapshot &&
        result.snapshot.shareOfLocalVoice === null &&
        result.snapshot.averageGridRank === null
      ) {
        unmatchedPlaceIds.push({
          name: scan.name,
          businessId: scan.business_id,
          googlePlaceId: scan.business_place_id,
          lbmScanId: scan.provider_scan_id,
          reason: "finished_but_subject_metrics_missing",
        });
      }
    } catch (error) {
      failed.push({
        name: scan.name,
        businessId: scan.business_id,
        googlePlaceId: scan.business_place_id,
        lbmScanId: scan.provider_scan_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        checked: scanIds.length,
        completed: completed.length,
        pending: pending.length,
        failed: failed.length,
        unmatchedPlaceIds,
        completedDetails: completed,
        pendingDetails: pending,
        failedDetails: failed,
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
