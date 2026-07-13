/**
 * Market-based Apify scrape: one Google Maps location job per market city.
 * Usage:
 *   tsx scripts/scrape-market-apify.ts --market=boise-metro --query="roofing contractor" --max-per-city=5
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import { getMarket, marketLocationQueries } from "../src/lib/markets";

config({ path: ".env.local" });

type RunResult = {
  city: string;
  locationQuery: string;
  runId: string;
  datasetId: string | null;
  status: string;
  itemCount: number;
  items: unknown[];
};

function parseArgs(argv: string[]) {
  let marketId = "boise-metro";
  let query = "roofing contractor";
  let maxPerCity = 5;

  for (const arg of argv) {
    if (arg.startsWith("--market=")) marketId = arg.split("=")[1];
    if (arg.startsWith("--query=")) query = arg.slice("--query=".length);
    if (arg.startsWith("--max-per-city=")) {
      maxPerCity = Number(arg.split("=")[1]);
    }
  }

  if (!Number.isFinite(maxPerCity) || maxPerCity < 1) {
    throw new Error("Invalid --max-per-city");
  }

  return { market: getMarket(marketId), query, maxPerCity };
}

function apifyToken(): string {
  const token =
    process.env.APIFY_DEFAULT_API_TOKEN || process.env.APIFY_TOKEN || "";
  if (!token) throw new Error("Missing APIFY_DEFAULT_API_TOKEN");
  return token;
}

async function startRun(
  token: string,
  input: Record<string, unknown>,
): Promise<{ id: string; defaultDatasetId: string }> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!res.ok) {
    throw new Error(`Start run failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data: { id: string; defaultDatasetId: string };
  };
  return json.data;
}

async function waitForRun(
  token: string,
  runId: string,
  timeoutMs = 10 * 60 * 1000,
): Promise<{ status: string; defaultDatasetId: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) {
      throw new Error(`Poll run failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: { status: string; defaultDatasetId: string };
    };
    const status = json.data.status;
    if (
      status === "SUCCEEDED" ||
      status === "FAILED" ||
      status === "ABORTED" ||
      status === "TIMED-OUT"
    ) {
      return {
        status,
        defaultDatasetId: json.data.defaultDatasetId,
      };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for run ${runId}`);
}

async function fetchDatasetItems(
  token: string,
  datasetId: string,
): Promise<unknown[]> {
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json&clean=true`,
  );
  if (!res.ok) {
    throw new Error(`Dataset fetch failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as unknown[];
}

async function main() {
  const { market, query, maxPerCity } = parseArgs(process.argv.slice(2));
  const token = apifyToken();
  const locations = marketLocationQueries(market);
  const results: RunResult[] = [];

  console.log(
    `Scraping market ${market.id}: ${locations.length} city jobs, query="${query}", maxPerCity=${maxPerCity}`,
  );

  for (const locationQuery of locations) {
    const city = locationQuery.split(",")[0].trim();
    console.log(`→ Starting ${city}: ${locationQuery}`);

    const run = await startRun(token, {
      searchStringsArray: [query],
      locationQuery,
      maxCrawledPlacesPerSearch: maxPerCity,
      language: "en",
      skipClosedPlaces: true,
      scrapePlaceDetailPage: true,
      maxReviews: 0,
      maxImages: 0,
    });

    const finished = await waitForRun(token, run.id);
    if (finished.status !== "SUCCEEDED") {
      console.error(`✗ ${city} ended with status ${finished.status}`);
      results.push({
        city,
        locationQuery,
        runId: run.id,
        datasetId: finished.defaultDatasetId,
        status: finished.status,
        itemCount: 0,
        items: [],
      });
      continue;
    }

    const items = await fetchDatasetItems(token, finished.defaultDatasetId);
    console.log(`✓ ${city}: ${items.length} places (run ${run.id})`);
    results.push({
      city,
      locationQuery,
      runId: run.id,
      datasetId: finished.defaultDatasetId,
      status: finished.status,
      itemCount: items.length,
      items,
    });
  }

  // Dedupe by placeId across cities
  const byPlaceId = new Map<string, unknown>();
  for (const result of results) {
    for (const item of result.items) {
      const place = item as { placeId?: string };
      if (!place.placeId) continue;
      if (!byPlaceId.has(place.placeId)) {
        byPlaceId.set(place.placeId, item);
      }
    }
  }

  const merged = [...byPlaceId.values()];
  mkdirSync("tmp", { recursive: true });
  const datasetPath = `tmp/${market.id}-roofing-market.json`;
  const metaPath = `tmp/${market.id}-roofing-market-meta.json`;

  writeFileSync(datasetPath, JSON.stringify(merged, null, 2));
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        marketId: market.id,
        query,
        maxPerCity,
        citiesScraped: locations.length,
        runs: results.map((r) => ({
          city: r.city,
          locationQuery: r.locationQuery,
          runId: r.runId,
          datasetId: r.datasetId,
          status: r.status,
          itemCount: r.itemCount,
        })),
        placesReturnedRaw: results.reduce((n, r) => n + r.itemCount, 0),
        placesReturnedDeduped: merged.length,
        datasetPath,
      },
      null,
      2,
    ),
  );

  console.log(
    JSON.stringify(
      {
        marketId: market.id,
        placesReturnedRaw: results.reduce((n, r) => n + r.itemCount, 0),
        placesReturnedDeduped: merged.length,
        datasetPath,
        metaPath,
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
