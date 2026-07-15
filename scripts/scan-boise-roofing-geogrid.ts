/**
 * Bulk-start LBM GeoGrid scans for qualified Boise Metro roofers (100+ reviews).
 * Creates scan requests + pending map_rank_snapshots rows, then exits.
 * Does not poll. Does not call Apify or Ahrefs.
 *
 * Usage: npm run scan:boise-roofing-geogrid
 * Later:  npm run check:boise-roofing-geogrid
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import { getMarket, normalizeCityName } from "../src/lib/markets";
import { startMapRankScan } from "../src/lib/map-rank-snapshots";

config({ path: ".env.local" });

const SEARCH_TERM = "Roofing contractor";
const GRID_SIZE = 5;
const SPACING = 2;

type Candidate = {
  id: string;
  name: string;
  city: string | null;
  google_place_id: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  review_count: number | null;
};

function toNum(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const market = getMarket("boise-metro");
  const allowed = new Set(market.cities.map(normalizeCityName));
  const db = await connectAdminPg();

  let candidates: Candidate[];
  try {
    const { rows } = await db.query<Candidate>(`
      select
        b.id,
        b.name,
        b.city,
        b.google_place_id,
        b.latitude,
        b.longitude,
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
      (r) => r.city && allowed.has(normalizeCityName(r.city)),
    );
  } finally {
    await db.end();
  }

  const submitted: unknown[] = [];
  const reused: unknown[] = [];
  const skipped: unknown[] = [];
  const unmatchedPlaceIds: unknown[] = [];
  const failures: unknown[] = [];
  let creditsExpectedNew = 0;
  let creditsAlreadyAccounted = 0;

  for (const business of candidates) {
    const placeId = business.google_place_id?.trim() || null;
    const lat = toNum(business.latitude);
    const lng = toNum(business.longitude);

    if (!placeId) {
      unmatchedPlaceIds.push({
        businessId: business.id,
        name: business.name,
        reason: "missing_google_place_id",
      });
      skipped.push({
        businessId: business.id,
        name: business.name,
        reason: "missing_google_place_id",
      });
      continue;
    }

    if (lat === null || lng === null) {
      skipped.push({
        businessId: business.id,
        name: business.name,
        googlePlaceId: placeId,
        reason: "missing_coordinates",
      });
      continue;
    }

    try {
      const result = await startMapRankScan({
        businessId: business.id,
        businessName: business.name,
        googlePlaceId: placeId,
        latitude: lat,
        longitude: lng,
        searchTerm: SEARCH_TERM,
        gridSize: GRID_SIZE,
        spacingValue: SPACING,
        spacingUnit: "miles",
        allowOffHoursOverride: process.argv.includes("--allow-off-hours"),
      });

      const row = {
        businessId: business.id,
        name: business.name,
        city: business.city,
        googlePlaceId: placeId,
        lbmScanId: result.providerScanId,
        snapshotId: result.snapshotId,
        status: result.status,
        created: result.created,
        reused: result.reused,
        deferred: result.deferred,
        schedule: result.schedule,
        creditsEstimated: result.creditsEstimated,
      };

      if (result.deferred) {
        skipped.push({
          businessId: business.id,
          name: business.name,
          reason: result.status,
          schedule: result.schedule,
        });
        continue;
      }

      if (result.created) {
        creditsExpectedNew += result.creditsEstimated;
        submitted.push(row);
      } else {
        if (result.status === "finished") {
          creditsAlreadyAccounted += GRID_SIZE * GRID_SIZE;
        } else {
          creditsAlreadyAccounted += result.creditsEstimated;
        }
        reused.push(row);
      }
    } catch (error) {
      failures.push({
        businessId: business.id,
        name: business.name,
        googlePlaceId: placeId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        cohortSize: candidates.length,
        searchTerm: SEARCH_TERM,
        gridSize: GRID_SIZE,
        spacingMiles: SPACING,
        scansSubmittedNew: submitted.length,
        scansReusedExisting: reused.length,
        skipped: skipped.length,
        failed: failures.length,
        creditsExpectedNew,
        creditsAlreadyAccounted,
        creditsExpectedMaxIfAllNew: candidates.length * GRID_SIZE * GRID_SIZE,
        unmatchedPlaceIds,
        failures,
        skippedDetails: skipped,
        submitted,
        reused,
        next: "npm run check:boise-roofing-geogrid",
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
