/**
 * Re-import city-missing places from a multi-city Apify discovery meta file.
 * Stamps `city` from each run's locationQuery city when Apify left city null.
 * Only imports Roofing contractor rows by default (via importApifyPlaces qualifyingOnly).
 *
 * Usage:
 *   npx tsx scripts/reimport-city-stamped-apify.ts \
 *     tmp/boise-metro-roofing-discovery-2026-07-15-meta.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { config } from "dotenv";
import { importApifyPlaces, type ApifyPlace } from "../src/lib/apify-import";

config({ path: ".env.local" });

type Meta = {
  marketId: string;
  runs: Array<{
    city: string;
    datasetId: string | null;
    runId: string;
    status: string;
  }>;
};

function apifyToken(): string {
  try {
    const raw = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        }),
    ) as Record<string, string>;
    const fileToken = raw.APIFY_TOKEN || raw.APIFY_DEFAULT_API_TOKEN;
    if (fileToken) return fileToken;
  } catch {
    // fall through
  }
  const token =
    process.env.APIFY_TOKEN || process.env.APIFY_DEFAULT_API_TOKEN || "";
  if (!token) throw new Error("Missing APIFY_TOKEN");
  return token;
}

async function fetchDataset(datasetId: string): Promise<ApifyPlace[]> {
  const token = apifyToken();
  const items: ApifyPlace[] = [];
  let offset = 0;
  const limit = 250;
  while (true) {
    const url = new URL(
      `https://api.apify.com/v2/datasets/${datasetId}/items`,
    );
    url.searchParams.set("token", token);
    url.searchParams.set("format", "json");
    url.searchParams.set("clean", "true");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Dataset ${datasetId} failed: ${res.status}`);
    }
    const batch = (await res.json()) as ApifyPlace[];
    items.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return items;
}

async function main() {
  const metaPath = process.argv[2];
  if (!metaPath) {
    throw new Error(
      "Usage: npx tsx scripts/reimport-city-stamped-apify.ts <meta.json>",
    );
  }

  const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Meta;
  const stamped: ApifyPlace[] = [];
  const byPlaceId = new Map<string, ApifyPlace>();
  const stats = {
    runs: [] as Array<{ city: string; fetched: number; stampedCity: number }>,
  };

  for (const run of meta.runs) {
    if (!run.datasetId || run.status !== "SUCCEEDED") continue;
    const items = await fetchDataset(run.datasetId);
    let stampedCity = 0;
    for (const item of items) {
      const next = { ...item };
      if (!next.city?.trim()) {
        next.city = run.city;
        stampedCity += 1;
      }
      if (!next.placeId) continue;
      // Prefer first city stamp; later cities don't overwrite an earlier explicit city
      if (!byPlaceId.has(next.placeId)) {
        byPlaceId.set(next.placeId, next);
      } else {
        const existing = byPlaceId.get(next.placeId)!;
        if (!existing.city?.trim() && next.city?.trim()) {
          byPlaceId.set(next.placeId, { ...existing, city: next.city });
        }
      }
    }
    stats.runs.push({ city: run.city, fetched: items.length, stampedCity });
  }

  stamped.push(...byPlaceId.values());
  mkdirSync("tmp", { recursive: true });
  const outPath = metaPath.replace(/-meta\.json$/, "-city-stamped.json");
  writeFileSync(outPath, JSON.stringify(stamped, null, 2));

  const importStats = await importApifyPlaces({
    places: stamped,
    marketId: meta.marketId || "boise-metro",
    mode: "discovery",
    qualifyingOnly: true,
  });

  // Focus report: previously city-missing roofing contractors that now imported
  const roofingWithStamp = stamped.filter(
    (p) =>
      (p.categoryName ?? "").trim().toLowerCase() === "roofing contractor",
  );

  console.log(
    JSON.stringify(
      {
        metaPath,
        outPath,
        fetchStats: stats.runs,
        placesStampedDeduped: stamped.length,
        roofingContractorInStamped: roofingWithStamp.length,
        import: {
          placesReturned: importStats.placesReturned,
          created: importStats.created,
          updated: importStats.updated,
          rejectedOutsideMarket: importStats.rejectedOutsideMarket,
          sectorExcluded: importStats.sectorExcluded,
          status: importStats.status,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
