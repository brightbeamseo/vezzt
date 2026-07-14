/**
 * Persist an LBM GeoGrid result against a Vezzt business via google_place_id.
 *
 * Usage:
 *   tsx scripts/store-lbm-geogrid.ts --place-id=ChIJ... --geogrid-id=zxm9mxq9
 *   tsx scripts/store-lbm-geogrid.ts --place-id=ChIJ... --from-file=tmp/lbm-geogrid-....json
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import {
  fetchLbmGeogrid,
  storeGeogridForPlaceId,
  type LbmGeogridPayload,
} from "../src/lib/lbm-geogrid";

config({ path: ".env.local" });

function parseArgs(argv: string[]) {
  let placeId = "";
  let geogridId = "";
  let fromFile = "";

  for (const arg of argv) {
    if (arg.startsWith("--place-id=")) placeId = arg.slice("--place-id=".length);
    if (arg.startsWith("--geogrid-id=")) {
      geogridId = arg.slice("--geogrid-id=".length);
    }
    if (arg.startsWith("--from-file=")) fromFile = arg.slice("--from-file=".length);
  }

  if (!placeId) throw new Error("Required: --place-id=<google_place_id>");
  if (!geogridId && !fromFile) {
    throw new Error("Required: --geogrid-id=... or --from-file=...");
  }

  return { placeId, geogridId, fromFile };
}

async function main() {
  const { placeId, geogridId, fromFile } = parseArgs(process.argv.slice(2));

  let payload: LbmGeogridPayload;
  if (fromFile) {
    payload = JSON.parse(readFileSync(fromFile, "utf8")) as LbmGeogridPayload;
  } else {
    payload = await fetchLbmGeogrid(geogridId);
  }

  if (payload.business_place_id && payload.business_place_id !== placeId) {
    throw new Error(
      `Refuse store: LBM business_place_id=${payload.business_place_id} != --place-id=${placeId}`,
    );
  }

  const result = await storeGeogridForPlaceId(placeId, payload);
  console.log(
    JSON.stringify(
      {
        ok: true,
        joinKey: "google_place_id",
        googlePlaceId: placeId,
        lbmGeogridId: payload.id,
        ...result,
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
