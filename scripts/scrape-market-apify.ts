/**
 * Full market discovery: one Apify job per (city × search term).
 * Deduplicates by placeId across all jobs.
 *
 * Usage:
 *   tsx scripts/scrape-market-apify.ts --market=boise-metro --mode=discovery --max-per-search=20 --concurrency=2
 *   tsx scripts/scrape-market-apify.ts --market=boise-metro --query="roofing contractor" --max-per-city=5
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "dotenv";
import {
  getMarket,
  marketDiscoveryJobs,
  marketLocationQueries,
} from "../src/lib/markets";

config({ path: ".env.local" });

type RunResult = {
  city: string;
  searchTerm: string;
  locationQuery: string;
  runId: string;
  datasetId: string | null;
  status: string;
  itemCount: number;
  usageTotalUsd: number | null;
  items: unknown[];
};

function parseArgs(argv: string[]) {
  let marketId = "boise-metro";
  let mode: "discovery" | "single" = "discovery";
  let query = "roofing contractor";
  let maxPerSearch = 20;
  let concurrency = 2;
  let cities: string[] | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--market=")) marketId = arg.split("=")[1];
    if (arg.startsWith("--mode=")) {
      mode = arg.split("=")[1] as "discovery" | "single";
    }
    if (arg.startsWith("--query=")) query = arg.slice("--query=".length);
    if (arg.startsWith("--max-per-search=")) {
      maxPerSearch = Number(arg.split("=")[1]);
    }
    if (arg.startsWith("--max-per-city=")) {
      maxPerSearch = Number(arg.split("=")[1]);
      mode = "single";
    }
    if (arg.startsWith("--concurrency=")) {
      concurrency = Number(arg.split("=")[1]);
    }
    if (arg.startsWith("--cities=")) {
      cities = arg
        .slice("--cities=".length)
        .split(",")
        .map((c) => c.trim())
        .filter(Boolean);
      mode = "single";
    }
  }

  if (!Number.isFinite(maxPerSearch) || maxPerSearch < 1) {
    throw new Error("Invalid max-per-search");
  }
  if (!Number.isFinite(concurrency) || concurrency < 1) {
    throw new Error("Invalid concurrency");
  }

  return {
    market: getMarket(marketId),
    mode,
    query,
    maxPerSearch,
    concurrency,
    cities,
  };
}

function apifyToken(): string {
  // Prefer .env.local file tokens locally (avoids secret-injection overlays).
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
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
  if (!token) throw new Error("Missing APIFY_TOKEN or APIFY_DEFAULT_API_TOKEN");
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
  timeoutMs = 45 * 60 * 1000,
): Promise<{
  status: string;
  defaultDatasetId: string;
  usageTotalUsd: number | null;
}> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) {
      throw new Error(`Poll run failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: {
        status: string;
        defaultDatasetId: string;
        usageTotalUsd?: number;
      };
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
        usageTotalUsd:
          typeof json.data.usageTotalUsd === "number"
            ? json.data.usageTotalUsd
            : null,
      };
    }
    await new Promise((r) => setTimeout(r, 4000));
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

async function runJob(
  token: string,
  job: { city: string; locationQuery: string; searchTerm: string },
  maxPerSearch: number,
): Promise<RunResult> {
  console.log(`→ ${job.city} / "${job.searchTerm}"`);
  const run = await startRun(token, {
    searchStringsArray: [job.searchTerm],
    locationQuery: job.locationQuery,
    maxCrawledPlacesPerSearch: maxPerSearch,
    language: "en",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: true,
    maxReviews: 0,
    maxImages: 0,
  });

  const finished = await waitForRun(token, run.id);
  if (finished.status !== "SUCCEEDED") {
    console.error(
      `✗ ${job.city} / "${job.searchTerm}" → ${finished.status}`,
    );
    return {
      city: job.city,
      searchTerm: job.searchTerm,
      locationQuery: job.locationQuery,
      runId: run.id,
      datasetId: finished.defaultDatasetId,
      status: finished.status,
      itemCount: 0,
      usageTotalUsd: finished.usageTotalUsd,
      items: [],
    };
  }

  const items = await fetchDatasetItems(token, finished.defaultDatasetId);
  console.log(
    `✓ ${job.city} / "${job.searchTerm}": ${items.length} places ($${finished.usageTotalUsd ?? "?"})`,
  );
  return {
    city: job.city,
    searchTerm: job.searchTerm,
    locationQuery: job.locationQuery,
    runId: run.id,
    datasetId: finished.defaultDatasetId,
    status: finished.status,
    itemCount: items.length,
    usageTotalUsd: finished.usageTotalUsd,
    items,
  };
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

async function main() {
  const { market, mode, query, maxPerSearch, concurrency, cities } = parseArgs(
    process.argv.slice(2),
  );
  const token = apifyToken();

  let jobs =
    mode === "discovery"
      ? marketDiscoveryJobs(market)
      : marketLocationQueries(market).map((locationQuery) => ({
          city: locationQuery.split(",")[0].trim(),
          locationQuery,
          searchTerm: query,
        }));

  if (cities && cities.length > 0) {
    jobs = cities.map((city) => {
      const canonical =
        market.cities.find((c) => c.toLowerCase() === city.toLowerCase()) ??
        city;
      return {
        city: canonical,
        locationQuery: `${canonical}, ${market.state}, USA`,
        searchTerm: query,
      };
    });
    const unknown = cities.filter(
      (c) =>
        !market.cities.some((mc) => mc.toLowerCase() === c.toLowerCase()),
    );
    if (unknown.length > 0) {
      console.warn(
        `Warning: cities outside market allowlist (still scraping): ${unknown.join(", ")}`,
      );
    }
  }

  console.log(
    `Market ${market.id}: ${jobs.length} jobs, mode=${mode}, maxPerSearch=${maxPerSearch}, concurrency=${concurrency}`,
  );

  const results = await mapPool(jobs, concurrency, (job) =>
    runJob(token, job, maxPerSearch),
  );

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
  const totalUsd = results.reduce((n, r) => n + (r.usageTotalUsd ?? 0), 0);
  mkdirSync("tmp", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const datasetPath = `tmp/${market.id}-roofing-discovery-${stamp}.json`;
  const metaPath = `tmp/${market.id}-roofing-discovery-${stamp}-meta.json`;

  writeFileSync(datasetPath, JSON.stringify(merged, null, 2));
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        marketId: market.id,
        mode,
        maxPerSearch,
        concurrency,
        jobsPlanned: jobs.length,
        runs: results.map((r) => ({
          city: r.city,
          searchTerm: r.searchTerm,
          locationQuery: r.locationQuery,
          runId: r.runId,
          datasetId: r.datasetId,
          status: r.status,
          itemCount: r.itemCount,
          usageTotalUsd: r.usageTotalUsd,
        })),
        placesReturnedRaw: results.reduce((n, r) => n + r.itemCount, 0),
        placesReturnedDeduped: merged.length,
        estimatedDiscoveryCostUsd: totalUsd,
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
        jobs: jobs.length,
        placesReturnedRaw: results.reduce((n, r) => n + r.itemCount, 0),
        placesReturnedDeduped: merged.length,
        estimatedDiscoveryCostUsd: totalUsd,
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
