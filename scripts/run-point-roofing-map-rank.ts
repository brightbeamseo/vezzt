/**
 * Single LBM GeoGrid start for Point Roofing (5x5 / 2 miles).
 * Creates the scan + pending DB row, prints the scan ID, exits.
 * Does not poll. Check later: npm run check:lbm-geogrid -- <scan-id>
 *
 * Enforces Mon–Fri 10:00–16:00 America/Boise unless allowOffHoursOverride.
 *
 * Usage: npm run scan:point-roofing-map-rank
 */
import { config } from "dotenv";
import { connectSupabasePg } from "./db";
import { startMapRankScan } from "../src/lib/map-rank-snapshots";

config({ path: ".env.local" });

const PLACE_ID = "ChIJDV1jJdJXrlQREkgwKq7DkMc";
const LAT = 43.5902932;
const LNG = -116.2422137;
const SEARCH_TERM = "Roofing contractor";
const GRID_SIZE = 5;
const SPACING = 2;

async function main() {
  let tokenPresent = false;
  try {
    const { readFileSync } = await import("node:fs");
    const raw = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
        }),
    ) as Record<string, string>;
    tokenPresent = Boolean(raw.LOCAL_BRAND_MANAGER_API_TOKEN);
  } catch {
    tokenPresent = Boolean(process.env.LOCAL_BRAND_MANAGER_API_TOKEN);
  }

  if (!tokenPresent) {
    throw new Error("LOCAL_BRAND_MANAGER_API_TOKEN not available");
  }

  const client = await connectSupabasePg();
  let business: { id: string; name: string; google_place_id: string };
  try {
    const { rows } = await client.query<{
      id: string;
      name: string;
      google_place_id: string;
    }>(
      `select id, name, google_place_id
       from public.businesses
       where google_place_id = $1`,
      [PLACE_ID],
    );
    if (!rows[0]) {
      throw new Error(`No Vezzt business for place_id=${PLACE_ID}`);
    }
    business = rows[0];
  } finally {
    await client.end();
  }

  const result = await startMapRankScan({
    businessId: business.id,
    businessName: business.name,
    googlePlaceId: PLACE_ID,
    latitude: LAT,
    longitude: LNG,
    searchTerm: SEARCH_TERM,
    gridSize: GRID_SIZE,
    spacingValue: SPACING,
    spacingUnit: "miles",
  });

  console.log(
    JSON.stringify(
      {
        ok: !result.deferred,
        started: result.created,
        deferred: result.deferred,
        reused: result.reused,
        status: result.status,
        schedule: result.schedule,
        providerScanId: result.providerScanId,
        snapshotId: result.snapshotId,
        creditsEstimated: result.creditsEstimated,
        businessId: business.id,
        googlePlaceId: PLACE_ID,
        next: result.providerScanId
          ? `npm run check:lbm-geogrid -- ${result.providerScanId}`
          : undefined,
      },
      null,
      2,
    ),
  );

  if (result.deferred) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
