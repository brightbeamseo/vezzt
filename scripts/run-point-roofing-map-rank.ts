/**
 * Single LBM GeoGrid test for Point Roofing (5x5 / 2 miles).
 * Does not scan any other business.
 *
 * Usage: tsx scripts/run-point-roofing-map-rank.ts
 */
import { config } from "dotenv";
import { connectSupabasePg } from "./db";
import { runAndStoreMapRankScan } from "../src/lib/map-rank-snapshots";

config({ path: ".env.local" });

const PLACE_ID = "ChIJDV1jJdJXrlQREkgwKq7DkMc";
const LAT = 43.5902932;
const LNG = -116.2422137;
const SEARCH_TERM = "Roofing contractor";
const GRID_SIZE = 5;
const SPACING = 2;

async function main() {
  // Preflight: token
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

  const creditsEstimated = GRID_SIZE * GRID_SIZE;
  console.log(
    JSON.stringify(
      {
        preflight: {
          creditsEstimated,
          creditsNote: "5×5 grid = 25 points = 25 GeoGrid credits (estimated)",
          tokenPresentServerSide: tokenPresent,
          schemaMatch: {
            endpoint: "POST /geogrids",
            required: [
              "business_name",
              "business_place_id",
              "grid_center_lat",
              "grid_center_lng",
              "search_term",
            ],
            grid_size: GRID_SIZE,
            grid_sizeAllowed: [3, 5, 7, 9, 13],
            grid_point_distance: SPACING,
            grid_distance_measure: "miles",
            grid_point_distanceMilesAllowed: [
              0.1, 0.25, 0.5, 0.75, 1, 2, 3, 5, 8, 10,
            ],
            joinKey: "business_place_id = google_place_id",
          },
        },
      },
      null,
      2,
    ),
  );

  if (!tokenPresent) {
    throw new Error("LOCAL_BRAND_MANAGER_API_TOKEN not available");
  }
  if (creditsEstimated !== 25) {
    throw new Error(`Expected 25 credits, got ${creditsEstimated}`);
  }

  const client = await connectSupabasePg();
  let business: {
    id: string;
    name: string;
    google_place_id: string;
  };
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

  console.log(
    JSON.stringify(
      {
        starting: true,
        businessId: business.id,
        name: business.name,
        googlePlaceId: business.google_place_id,
        coords: { lat: LAT, lng: LNG },
        searchTerm: SEARCH_TERM,
        gridSize: GRID_SIZE,
        spacing: `${SPACING} miles`,
      },
      null,
      2,
    ),
  );

  const result = await runAndStoreMapRankScan({
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

  const competitors = Array.isArray(result.snapshot.competitors)
    ? result.snapshot.competitors
    : [];
  const competitorPlaceIds = competitors
    .map((c: { place_id?: string }) => c.place_id)
    .filter(Boolean);

  console.log(
    JSON.stringify(
      {
        ok: true,
        creditsUsedEstimated: result.creditsEstimated,
        lbmScanId: result.providerScanId,
        finalStatus: result.snapshot.status,
        databaseRowId: result.snapshot.id,
        businessId: result.snapshot.businessId,
        businessPlaceId: result.snapshot.businessPlaceId,
        solv: result.snapshot.shareOfLocalVoice,
        agr: result.snapshot.averageGridRank,
        atgr: result.snapshot.averageTotalGridRank,
        top3Count: result.snapshot.foundInTop3Count,
        top10Count: result.snapshot.foundInTop10Count,
        totalGridPoints: result.snapshot.totalGridPoints,
        ranks: result.snapshot.ranks,
        competitorPlaceIdCount: competitorPlaceIds.length,
        scannedAt: result.snapshot.scannedAt,
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
