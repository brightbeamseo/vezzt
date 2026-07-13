/**
 * Reset pilot business data and rebuild the initial Boise Metro roofing dataset.
 *
 * - Clears dependent tables (FK-safe), not schema
 * - Apify: "roofing contractor" × each accepted city (basic details only)
 * - Imports only qualifying Roofing contractor businesses
 * - Does not calculate Growth Score / Vestimate
 * - Does not leave recurring schedules enabled
 *
 * Usage: tsx scripts/reset-and-rebuild-roofing.ts
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { config } from "dotenv";
import { getMarket, marketDiscoveryJobs } from "../src/lib/markets";
import {
  importApifyPlaces,
  type ApifyPlace,
} from "../src/lib/apify-import";
import { connectSupabasePg } from "./db";

config({ path: ".env.local" });

const SEARCH_TERM = "roofing contractor";
const MAX_PER_SEARCH = 50;
const CONCURRENCY = 2;

type RunResult = {
  city: string;
  searchTerm: string;
  locationQuery: string;
  runId: string;
  datasetId: string | null;
  status: string;
  itemCount: number;
  usageTotalUsd: number | null;
  items: ApifyPlace[];
};

function apifyToken(): string {
  try {
    const raw = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
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

async function tableExists(
  client: Awaited<ReturnType<typeof connectSupabasePg>>,
  name: string,
): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = 'public' and table_name = $1
     ) as exists`,
    [name],
  );
  return rows[0]?.exists === true;
}

async function countTable(
  client: Awaited<ReturnType<typeof connectSupabasePg>>,
  name: string,
): Promise<number | null> {
  if (!(await tableExists(client, name))) return null;
  const { rows } = await client.query<{ n: string }>(
    `select count(*)::text as n from public.${name}`,
  );
  return Number(rows[0].n);
}

async function clearPilotData() {
  const client = await connectSupabasePg();
  const before: Record<string, number | null> = {};
  const after: Record<string, number | null> = {};

  const tables = [
    "proprietary_scores",
    "business_metrics",
    "business_enrichment",
    "review_snapshots",
    "business_locations",
    "collection_rejections",
    "scrape_runs",
    "import_runs",
    "businesses",
  ] as const;

  try {
    for (const t of tables) {
      before[t] = await countTable(client, t);
    }

    await client.query("begin");

    if (await tableExists(client, "proprietary_scores")) {
      await client.query("delete from public.proprietary_scores");
    }
    await client.query("delete from public.business_metrics");
    await client.query("delete from public.business_enrichment");
    await client.query("delete from public.review_snapshots");
    if (await tableExists(client, "business_locations")) {
      await client.query("delete from public.business_locations");
    }
    if (await tableExists(client, "collection_rejections")) {
      await client.query("delete from public.collection_rejections");
    }
    if (await tableExists(client, "import_runs")) {
      await client.query("delete from public.import_runs");
    }
    await client.query("delete from public.scrape_runs");
    await client.query("delete from public.businesses");

    await client.query("commit");

    for (const t of tables) {
      after[t] = await countTable(client, t);
    }

    return { before, after };
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // ignore
    }
    throw error;
  } finally {
    await client.end();
  }
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
  timeoutMs = 20 * 60 * 1000,
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
): Promise<ApifyPlace[]> {
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
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(limit));
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Dataset fetch failed: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as ApifyPlace[];
    items.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return items;
}

async function runCityJob(
  token: string,
  job: { city: string; locationQuery: string; searchTerm: string },
): Promise<RunResult> {
  console.log(`→ ${job.city} / "${job.searchTerm}"`);
  const run = await startRun(token, {
    searchStringsArray: [job.searchTerm],
    locationQuery: job.locationQuery,
    maxCrawledPlacesPerSearch: MAX_PER_SEARCH,
    language: "en",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: true,
    maxReviews: 0,
    maxImages: 0,
    scrapeContacts: false,
    scrapeDirectories: false,
    includeWebResults: false,
    maximumLeadsEnrichmentRecords: 0,
  });

  const finished = await waitForRun(token, run.id);
  if (finished.status !== "SUCCEEDED") {
    console.error(`✗ ${job.city} → ${finished.status}`);
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
    `✓ ${job.city}: ${items.length} places ($${finished.usageTotalUsd ?? "?"})`,
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
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      worker(),
    ),
  );
  return results;
}

async function disableRecurringSchedules() {
  const token = apifyToken();
  const res = await fetch(
    `https://api.apify.com/v2/schedules?limit=100&token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) {
    console.warn(`Could not list Apify schedules: ${res.status}`);
    return [];
  }
  const json = (await res.json()) as {
    data: {
      items: {
        id: string;
        name: string;
        isEnabled: boolean;
        title?: string;
        cronExpression: string;
        timezone: string;
        description?: string;
        isExclusive?: boolean;
        actions?: unknown[];
      }[];
    };
  };

  const disabled: string[] = [];
  for (const s of json.data.items) {
    if (
      !s.isEnabled ||
      (!s.name.includes("boise-roofing") && !s.name.includes("roofing"))
    ) {
      continue;
    }
    const detailRes = await fetch(
      `https://api.apify.com/v2/schedules/${s.id}?token=${encodeURIComponent(token)}`,
    );
    const detail = (await detailRes.json()) as { data: typeof s };
    const d = detail.data;
    await fetch(
      `https://api.apify.com/v2/schedules/${s.id}?token=${encodeURIComponent(token)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: d.name,
          title: d.title ?? d.name,
          isEnabled: false,
          isExclusive: d.isExclusive ?? true,
          cronExpression: d.cronExpression,
          timezone: d.timezone,
          description:
            (d.description ?? "") +
            " [DISABLED — manual rebuild; do not schedule yet]",
          actions: d.actions ?? [],
        }),
      },
    );
    disabled.push(`${d.name} (${d.id})`);
  }
  return disabled;
}

async function main() {
  const market = getMarket("boise-metro");
  console.log("=== 1. Clear pilot data ===");
  const cleared = await clearPilotData();
  console.log(JSON.stringify(cleared, null, 2));

  const emptyCheck = cleared.after;
  const businessish = [
    "businesses",
    "review_snapshots",
    "business_metrics",
    "business_enrichment",
    "scrape_runs",
  ] as const;
  for (const t of businessish) {
    if ((emptyCheck[t] ?? 0) !== 0) {
      throw new Error(`Expected ${t} to be empty, got ${emptyCheck[t]}`);
    }
  }
  console.log("Confirmed business tables empty.");

  console.log("=== 2. Disable recurring Apify schedules ===");
  const disabledSchedules = await disableRecurringSchedules();
  console.log({ disabledSchedules });

  console.log("=== 3. Apify discovery (one term × city) ===");
  const token = apifyToken();
  const jobs = marketDiscoveryJobs(market, [SEARCH_TERM]);
  console.log(
    `Jobs: ${jobs.length} (${SEARCH_TERM} × ${market.cities.join(", ")})`,
  );

  const results = await mapPool(jobs, CONCURRENCY, (job) =>
    runCityJob(token, job),
  );

  const byPlaceId = new Map<string, ApifyPlace>();
  let raw = 0;
  for (const result of results) {
    raw += result.itemCount;
    for (const item of result.items) {
      if (!item.placeId) continue;
      if (!byPlaceId.has(item.placeId)) {
        byPlaceId.set(item.placeId, item);
      }
    }
  }
  const uniquePlaces = [...byPlaceId.values()];
  const duplicatesRemoved = raw - uniquePlaces.length;
  const exactApifyCostUsd = results.reduce(
    (n, r) => n + (r.usageTotalUsd ?? 0),
    0,
  );

  mkdirSync("tmp", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const datasetPath = `tmp/${market.id}-roofing-rebuild-${stamp}.json`;
  const metaPath = `tmp/${market.id}-roofing-rebuild-${stamp}-meta.json`;
  writeFileSync(datasetPath, JSON.stringify(uniquePlaces, null, 2));
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        marketId: market.id,
        cities: market.cities,
        searchTerm: SEARCH_TERM,
        maxPerSearch: MAX_PER_SEARCH,
        runs: results.map((r) => ({
          city: r.city,
          runId: r.runId,
          datasetId: r.datasetId,
          status: r.status,
          itemCount: r.itemCount,
          usageTotalUsd: r.usageTotalUsd,
        })),
        placesReturnedRaw: raw,
        placesReturnedDeduped: uniquePlaces.length,
        duplicatesRemoved,
        exactApifyCostUsd,
        datasetPath,
      },
      null,
      2,
    ),
  );

  console.log("=== 4. Import qualifying businesses ===");
  const importStats = await importApifyPlaces({
    places: uniquePlaces,
    marketId: market.id,
    mode: "discovery",
    qualifyingOnly: true,
    apifyRunId: `rebuild:${stamp}`,
    snapshotDate: stamp,
  });

  const client = await connectSupabasePg();
  let dbSummary;
  try {
    const { rows } = await client.query<{
      total: string;
      with_100_plus: string;
      under_100: string;
      missing_reviews: string;
      missing_rating: string;
      missing_address: string;
      missing_coords: string;
    }>(`
      select
        count(*)::text as total,
        count(*) filter (
          where coalesce((
            select rs.review_count from review_snapshots rs
            where rs.business_id = b.id
            order by rs.snapshot_date desc limit 1
          ), 0) >= 100
        )::text as with_100_plus,
        count(*) filter (
          where coalesce((
            select rs.review_count from review_snapshots rs
            where rs.business_id = b.id
            order by rs.snapshot_date desc limit 1
          ), 0) < 100
        )::text as under_100,
        count(*) filter (
          where (
            select rs.review_count from review_snapshots rs
            where rs.business_id = b.id
            order by rs.snapshot_date desc limit 1
          ) is null
        )::text as missing_reviews,
        count(*) filter (
          where (
            select rs.average_rating from review_snapshots rs
            where rs.business_id = b.id
            order by rs.snapshot_date desc limit 1
          ) is null
        )::text as missing_rating,
        count(*) filter (where address is null or address = '')::text as missing_address,
        count(*) filter (where latitude is null or longitude is null)::text as missing_coords
      from businesses b
      where target_sector = 'roofing'
    `);
    dbSummary = rows[0];
  } finally {
    await client.end();
  }

  const report = {
    market: {
      id: market.id,
      name: market.name,
      cities: market.cities,
      sector: "Roofing",
      qualification:
        'primary categoryName === "Roofing contractor"; city allowlist; permanently closed excluded; dedupe google_place_id',
    },
    clearedTables: cleared,
    discovery: {
      searchTerm: SEARCH_TERM,
      citiesSearched: market.cities,
      rawApifyResults: raw,
      uniquePlaceIds: uniquePlaces.length,
      duplicateResultsRemoved: duplicatesRemoved,
      exactApifyCostUsd: Number(exactApifyCostUsd.toFixed(6)),
      runs: results.map((r) => ({
        city: r.city,
        status: r.status,
        itemCount: r.itemCount,
        usageTotalUsd: r.usageTotalUsd,
      })),
    },
    import: {
      rejectedWrongCity: importStats.rejectedOutsideMarket,
      rejectedWrongPrimaryCategory: importStats.sectorExcluded,
      excludedPermanentlyClosed: importStats.rejectedClosed,
      businessesCreated: importStats.created,
      businessesUpdated: importStats.updated,
      reviewSnapshotsCreated: importStats.snapshotsCreated,
      failed: importStats.failed,
    },
    qualifying: {
      roofingBusinesses: Number(dbSummary.total),
      with100PlusReviews: Number(dbSummary.with_100_plus),
      under100Reviews: Number(dbSummary.under_100),
    },
    dataGaps: {
      missingReviewCounts: Number(dbSummary.missing_reviews),
      missingRatings: Number(dbSummary.missing_rating),
      missingAddresses: Number(dbSummary.missing_address),
      missingCoordinates: Number(dbSummary.missing_coords),
    },
    disabledSchedules,
    notes: [
      "No Growth Score or Vestimate calculated.",
      "Recurring schedules disabled for this rebuild.",
      "Dashboard defaults to showing 100+ review businesses.",
      "Uniqueness: google_place_id UNIQUE.",
    ],
    datasetPath,
    metaPath,
  };

  const reportPath = `tmp/${market.id}-rebuild-report-${stamp}.json`;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
