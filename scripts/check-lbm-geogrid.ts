/**
 * One-shot LBM GeoGrid status check. Does not poll.
 *
 * Usage:
 *   npm run check:lbm-geogrid -- z7ovo67o
 *   tsx scripts/check-lbm-geogrid.ts z7ovo67o
 */
import { config } from "dotenv";
import { checkLbmGeogridOnce } from "../src/lib/map-rank-snapshots";

config({ path: ".env.local" });

async function main() {
  const scanId = process.argv[2]?.trim();
  if (!scanId) {
    throw new Error("Usage: npm run check:lbm-geogrid -- <scan-id>");
  }

  const result = await checkLbmGeogridOnce(scanId);
  console.log(
    JSON.stringify(
      {
        ok: true,
        providerScanId: result.providerScanId,
        lbmState: result.lbmState,
        action: result.action,
        message: result.message,
        snapshot: result.snapshot
          ? {
              id: result.snapshot.id,
              businessId: result.snapshot.businessId,
              businessPlaceId: result.snapshot.businessPlaceId,
              status: result.snapshot.status,
              solv: result.snapshot.shareOfLocalVoice,
              agr: result.snapshot.averageGridRank,
              atgr: result.snapshot.averageTotalGridRank,
              top3Count: result.snapshot.foundInTop3Count,
              top10Count: result.snapshot.foundInTop10Count,
              scannedAt: result.snapshot.scannedAt,
            }
          : null,
      },
      null,
      2,
    ),
  );

  if (result.action === "failed") process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
