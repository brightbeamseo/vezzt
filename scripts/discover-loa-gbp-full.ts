/**
 * Phase IIIB — Full LOA roofing GBP discovery.
 *
 * Pattern: 5 map points × 60 results, startUrls only (no locationQuery).
 * Resume-safe via loa_gbp_search_runs. Reuses successful pilot Apify runs.
 *
 * Usage:
 *   npm run discover:loa-gbp              # all LOAs
 *   npm run discover:loa-gbp -- --import-only
 *   npm run discover:loa-gbp -- --limit=10
 *   npm run discover:loa-gbp -- --loa=boise-city-meridian-kuna-idaho-boise-metro
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { createAdminPgPool } from "../src/lib/admin-db";
import { distanceMiles } from "../src/lib/local-opportunity-areas";
import { mapsSearchUrl } from "../src/lib/markets";
import type { Pool, PoolClient } from "pg";

config({ path: ".env.local" });

const OUT_DIR = join(process.cwd(), "tmp", "loa-gbp-full");
const PILOT_RUNS = join(process.cwd(), "tmp", "loa-gbp-pilot", "runs.json");
const SEARCH_TERM = "roofing contractor";
const MAX_PER_SEARCH = 60;
const OFFSET_MILES = 8;
const ZOOM = 13;
const RADIUS_MILES = 15;
const CONCURRENCY = 6;

type PointKey = "center" | "north" | "east" | "south" | "west";
const POINT_ORDER: PointKey[] = ["center", "north", "east", "south", "west"];

type PlaceRow = {
  placeId?: string | null;
  title?: string | null;
  categoryName?: string | null;
  categories?: string[] | null;
  totalScore?: number | null;
  reviewsCount?: number | null;
  location?: { lat?: number; lng?: number } | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  website?: string | null;
  phone?: string | null;
  permanentlyClosed?: boolean | null;
  temporarilyClosed?: boolean | null;
  rank?: number | null;
  [key: string]: unknown;
};

type LoaRow = {
  id: string;
  slug: string;
  display_name: string;
  center_lat: number;
  center_lng: number;
};

type PilotRun = {
  loaSlug: string;
  point: PointKey;
  lat: number;
  lng: number;
  mapsUrl: string;
  runId: string;
  datasetId: string;
  status: string;
  usageTotalUsd: number | null;
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
    const t = raw.APIFY_TOKEN || raw.APIFY_DEFAULT_API_TOKEN;
    if (t) return t;
  } catch {
    // fall through
  }
  const t = process.env.APIFY_TOKEN || process.env.APIFY_DEFAULT_API_TOKEN || "";
  if (!t) throw new Error("Missing APIFY_TOKEN");
  return t;
}

function offsetLatLng(
  lat: number,
  lng: number,
  northMiles: number,
  eastMiles: number,
): { lat: number; lng: number } {
  const dLat = northMiles / 69.0;
  const dLng = eastMiles / (69.0 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

function buildPoints(center: {
  lat: number;
  lng: number;
}): Record<PointKey, { lat: number; lng: number }> {
  return {
    center,
    north: offsetLatLng(center.lat, center.lng, OFFSET_MILES, 0),
    east: offsetLatLng(center.lat, center.lng, 0, OFFSET_MILES),
    south: offsetLatLng(center.lat, center.lng, -OFFSET_MILES, 0),
    west: offsetLatLng(center.lat, center.lng, 0, -OFFSET_MILES),
  };
}

function qualifyBucket(
  p: PlaceRow,
): "primary" | "secondary" | "other" {
  const primary = (p.categoryName ?? "").trim().toLowerCase();
  if (primary === "roofing contractor") return "primary";
  const cats = [
    ...(Array.isArray(p.categories) ? p.categories : []),
  ].map((c) => String(c).trim().toLowerCase());
  if (cats.some((c) => c === "roofing contractor")) return "secondary";
  return "other";
}

async function startRun(
  token: string,
  mapsUrl: string,
): Promise<{ id: string; defaultDatasetId: string }> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startUrls: [{ url: mapsUrl }],
        maxCrawledPlacesPerSearch: MAX_PER_SEARCH,
        language: "en",
        skipClosedPlaces: false,
        scrapePlaceDetailPage: true,
        maxReviews: 0,
        maxImages: 0,
        includeWebResults: false,
      }),
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
): Promise<{
  status: string;
  defaultDatasetId: string;
  usageTotalUsd: number | null;
}> {
  const started = Date.now();
  while (Date.now() - started < 50 * 60 * 1000) {
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
    );
    if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
    const json = (await res.json()) as {
      data: {
        status: string;
        defaultDatasetId: string;
        usageTotalUsd?: number;
      };
    };
    const s = json.data.status;
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(s)) {
      return {
        status: s,
        defaultDatasetId: json.data.defaultDatasetId,
        usageTotalUsd:
          typeof json.data.usageTotalUsd === "number"
            ? json.data.usageTotalUsd
            : null,
      };
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error(`Timeout waiting for ${runId}`);
}

async function fetchDataset(
  token: string,
  datasetId: string,
): Promise<PlaceRow[]> {
  const all: PlaceRow[] = [];
  let offset = 0;
  const limit = 250;
  for (;;) {
    const url = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json&clean=true&limit=${limit}&offset=${offset}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Dataset fetch failed: ${res.status}`);
    const batch = (await res.json()) as PlaceRow[];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return all;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      worker(),
    ),
  );
}

async function upsertBusiness(
  client: PoolClient,
  item: PlaceRow,
): Promise<string | null> {
  const placeId =
    typeof item.placeId === "string" && item.placeId.trim()
      ? item.placeId.trim()
      : null;
  if (!placeId) return null;

  const bucket = qualifyBucket(item);
  const categories = Array.isArray(item.categories)
    ? item.categories.filter((c): c is string => typeof c === "string")
    : [];

  await client.query(
    `insert into loa_gbp_businesses (
      place_id, title, category_name, categories, qualify_bucket,
      reviews_count, total_score, address, city, state, postal_code,
      lat, lng, website, phone, permanently_closed, temporarily_closed, raw, updated_at
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18, now()
    )
    on conflict (place_id) do update set
      title = coalesce(excluded.title, loa_gbp_businesses.title),
      category_name = coalesce(excluded.category_name, loa_gbp_businesses.category_name),
      categories = case when cardinality(excluded.categories) > 0 then excluded.categories else loa_gbp_businesses.categories end,
      qualify_bucket = excluded.qualify_bucket,
      reviews_count = coalesce(excluded.reviews_count, loa_gbp_businesses.reviews_count),
      total_score = coalesce(excluded.total_score, loa_gbp_businesses.total_score),
      address = coalesce(excluded.address, loa_gbp_businesses.address),
      city = coalesce(excluded.city, loa_gbp_businesses.city),
      state = coalesce(excluded.state, loa_gbp_businesses.state),
      postal_code = coalesce(excluded.postal_code, loa_gbp_businesses.postal_code),
      lat = coalesce(excluded.lat, loa_gbp_businesses.lat),
      lng = coalesce(excluded.lng, loa_gbp_businesses.lng),
      website = coalesce(excluded.website, loa_gbp_businesses.website),
      phone = coalesce(excluded.phone, loa_gbp_businesses.phone),
      permanently_closed = excluded.permanently_closed,
      temporarily_closed = excluded.temporarily_closed,
      raw = coalesce(excluded.raw, loa_gbp_businesses.raw),
      updated_at = now()`,
    [
      placeId,
      item.title ?? null,
      item.categoryName ?? null,
      categories,
      bucket,
      typeof item.reviewsCount === "number" ? item.reviewsCount : null,
      typeof item.totalScore === "number" ? item.totalScore : null,
      item.address ?? null,
      item.city ?? null,
      item.state ?? null,
      item.postalCode ?? null,
      item.location?.lat ?? null,
      item.location?.lng ?? null,
      item.website ?? null,
      item.phone ?? null,
      Boolean(item.permanentlyClosed),
      Boolean(item.temporarilyClosed),
      JSON.stringify(item),
    ],
  );
  return placeId;
}

async function importRunItems(
  client: PoolClient,
  args: {
    loa: LoaRow;
    point: PointKey;
    searchRunId: string;
    items: PlaceRow[];
  },
) {
  for (let idx = 0; idx < args.items.length; idx++) {
    const item = args.items[idx]!;
    const placeId = await upsertBusiness(client, item);
    if (!placeId) continue;
    const lat = item.location?.lat ?? null;
    const lng = item.location?.lng ?? null;
    const dist =
      lat != null && lng != null
        ? distanceMiles(
            { lat: args.loa.center_lat, lng: args.loa.center_lng },
            { lat, lng },
          )
        : null;
    const rank =
      typeof item.rank === "number" && item.rank > 0 ? item.rank : idx + 1;
    await client.query(
      `insert into loa_gbp_sightings (
        loa_id, place_id, search_point, search_run_id,
        rank_in_search, distance_miles, in_radius
      ) values ($1,$2,$3,$4,$5,$6,$7)
      on conflict (loa_id, place_id, search_point) do update set
        search_run_id = excluded.search_run_id,
        rank_in_search = least(
          coalesce(loa_gbp_sightings.rank_in_search, excluded.rank_in_search),
          excluded.rank_in_search
        ),
        distance_miles = coalesce(excluded.distance_miles, loa_gbp_sightings.distance_miles),
        in_radius = coalesce(excluded.in_radius, loa_gbp_sightings.in_radius),
        scraped_at = now()`,
      [
        args.loa.id,
        placeId,
        args.point,
        args.searchRunId,
        rank,
        dist,
        dist != null ? dist <= RADIUS_MILES : null,
      ],
    );
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    importOnly: args.includes("--import-only"),
    limit: Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1]) || 0,
    loaSlug: args.find((a) => a.startsWith("--loa="))?.split("=")[1] ?? null,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const opts = parseArgs();
  const token = apifyToken();
  const pool: Pool = createAdminPgPool(CONCURRENCY + 2);

  const { rows: loas } = await pool.query<LoaRow>(
    `select id, slug, display_name, center_lat::float, center_lng::float
     from local_opportunity_areas
     ${opts.loaSlug ? "where slug = $1" : ""}
     order by population desc nulls last`,
    opts.loaSlug ? [opts.loaSlug] : [],
  );

  // Ensure competition stub rows
  await pool.query(
    `insert into loa_roofing_competition (loa_id)
     select id from local_opportunity_areas
     on conflict (loa_id) do nothing`,
  );

  const { rows: doneRuns } = await pool.query<{
    loa_id: string;
    search_point: string;
    status: string;
  }>(
    `select loa_id, search_point, status from loa_gbp_search_runs where status = 'SUCCEEDED'`,
  );
  const doneKey = new Set(
    doneRuns.map((r) => `${r.loa_id}:${r.search_point}`),
  );

  // Seed known pilot Apify runs into job list when not yet in DB
  const pilotRuns: PilotRun[] = existsSync(PILOT_RUNS)
    ? (JSON.parse(readFileSync(PILOT_RUNS, "utf8")) as PilotRun[]).filter(
        (r) => r.status === "SUCCEEDED",
      )
    : [];
  const pilotByKey = new Map(
    pilotRuns.map((r) => [`${r.loaSlug}:${r.point}`, r] as const),
  );

  type Job = {
    loa: LoaRow;
    point: PointKey;
    lat: number;
    lng: number;
    mapsUrl: string;
    reuse?: PilotRun;
  };

  const jobs: Job[] = [];
  for (const loa of loas) {
    const points = buildPoints({ lat: loa.center_lat, lng: loa.center_lng });
    for (const point of POINT_ORDER) {
      if (doneKey.has(`${loa.id}:${point}`)) continue;
      const pt = points[point];
      const reuse = pilotByKey.get(`${loa.slug}:${point}`);
      jobs.push({
        loa,
        point,
        lat: pt.lat,
        lng: pt.lng,
        mapsUrl:
          reuse?.mapsUrl ??
          mapsSearchUrl(SEARCH_TERM, {
            lat: pt.lat,
            lng: pt.lng,
            zoom: ZOOM,
          }),
        reuse,
      });
    }
  }

  const limited = opts.limit > 0 ? jobs.slice(0, opts.limit) : jobs;
  console.log(
    `LOAs=${loas.length} remaining jobs=${limited.length} (of ${jobs.length}) concurrency=${CONCURRENCY} importOnly=${opts.importOnly}`,
  );

  let completed = 0;
  let failed = 0;
  let cost = 0;

  const progressPath = join(OUT_DIR, "progress.json");
  const saveProgress = () => {
    writeFileSync(
      progressPath,
      JSON.stringify(
        {
          completed,
          failed,
          remaining: limited.length - completed - failed,
          costUsd: Number(cost.toFixed(4)),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  };

  await mapPool(limited, CONCURRENCY, async (job) => {
    const client = await pool.connect();
    try {
      let runId: string;
      let datasetId: string;
      let status: string;
      let usage: number | null;

      if (job.reuse) {
        console.log(`↺ pilot ${job.loa.display_name} / ${job.point}`);
        runId = job.reuse.runId;
        datasetId = job.reuse.datasetId;
        status = "SUCCEEDED";
        usage = job.reuse.usageTotalUsd;
      } else if (opts.importOnly) {
        console.log(`skip (import-only) ${job.loa.display_name} / ${job.point}`);
        return;
      } else {
        console.log(`→ ${job.loa.display_name} / ${job.point}`);
        const started = await startRun(token, job.mapsUrl);
        const finished = await waitForRun(token, started.id);
        runId = started.id;
        datasetId = finished.defaultDatasetId;
        status = finished.status;
        usage = finished.usageTotalUsd;
      }

      if (status !== "SUCCEEDED") {
        await client.query(
          `insert into loa_gbp_search_runs (
            loa_id, search_point, search_lat, search_lng, maps_url,
            apify_run_id, dataset_id, status, usage_usd, raw_count
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,0)
          on conflict (loa_id, search_point) do update set
            apify_run_id = excluded.apify_run_id,
            dataset_id = excluded.dataset_id,
            status = excluded.status,
            usage_usd = excluded.usage_usd,
            scraped_at = now()`,
          [
            job.loa.id,
            job.point,
            job.lat,
            job.lng,
            job.mapsUrl,
            runId,
            datasetId,
            status,
            usage,
          ],
        );
        failed += 1;
        saveProgress();
        console.error(`✗ ${job.loa.display_name}/${job.point} ${status}`);
        return;
      }

      const items = await fetchDataset(token, datasetId);
      await client.query("begin");
      const runInsert = await client.query<{ id: string }>(
        `insert into loa_gbp_search_runs (
          loa_id, search_point, search_lat, search_lng, maps_url,
          apify_run_id, dataset_id, status, usage_usd, raw_count
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (loa_id, search_point) do update set
          apify_run_id = excluded.apify_run_id,
          dataset_id = excluded.dataset_id,
          status = excluded.status,
          usage_usd = excluded.usage_usd,
          raw_count = excluded.raw_count,
          scraped_at = now()
        returning id`,
        [
          job.loa.id,
          job.point,
          job.lat,
          job.lng,
          job.mapsUrl,
          runId,
          datasetId,
          status,
          usage,
          items.length,
        ],
      );
      const searchRunId = runInsert.rows[0]!.id;
      // Clear prior sightings for this point so re-import is clean
      await client.query(
        `delete from loa_gbp_sightings
         where loa_id = $1 and search_point = $2`,
        [job.loa.id, job.point],
      );
      await importRunItems(client, {
        loa: job.loa,
        point: job.point,
        searchRunId,
        items,
      });
      await client.query("commit");

      completed += 1;
      if (usage) cost += usage;
      saveProgress();
      console.log(
        `✓ ${job.loa.display_name}/${job.point} raw=${items.length} $${usage ?? "?"} [${completed}/${limited.length}]`,
      );
    } catch (e) {
      try {
        await client.query("rollback");
      } catch {
        // ignore
      }
      failed += 1;
      saveProgress();
      console.error(`✗ ${job.loa.display_name}/${job.point}`, e);
    } finally {
      client.release();
    }
  });

  // Update discovery status stubs
  await pool.query(`
    update loa_roofing_competition c set
      search_points_complete = s.n,
      gbp_discovery_status = case
        when s.n >= 5 then 'complete'
        when s.n > 0 then 'partial'
        else 'pending'
      end,
      discovery_cost_usd = s.cost,
      updated_at = now()
    from (
      select loa_id,
             count(*) filter (where status = 'SUCCEEDED')::int as n,
             coalesce(sum(usage_usd),0) as cost
      from loa_gbp_search_runs
      group by loa_id
    ) s
    where c.loa_id = s.loa_id
  `);

  const { rows: summary } = await pool.query(`
    select
      (select count(*) from local_opportunity_areas) as loas,
      (select count(*) from loa_gbp_search_runs where status='SUCCEEDED') as runs_ok,
      (select coalesce(sum(usage_usd),0) from loa_gbp_search_runs) as cost,
      (select count(*) from loa_gbp_businesses) as unique_places,
      (select count(*) from loa_gbp_sightings) as sightings
  `);

  console.log("\n=== DISCOVERY PROGRESS ===");
  console.log(summary[0]);
  console.log(`This session: completed=${completed} failed=${failed} cost≈$${cost.toFixed(2)}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
