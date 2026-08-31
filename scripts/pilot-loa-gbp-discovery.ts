/**
 * Phase IIIA GBP discovery pilot — 6 LOAs × 5 search points × 60 results.
 *
 * One Apify run per search point so incremental discovery is attributable.
 * Does NOT import into production businesses table.
 *
 * Usage: npm run pilot:loa-gbp
 * Resume-safe: reuses SUCCEEDED runs from tmp/loa-gbp-pilot/runs.json
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import { distanceMiles } from "../src/lib/local-opportunity-areas";
import { mapsSearchUrl } from "../src/lib/markets";

config({ path: ".env.local" });

const OUT_DIR = join(process.cwd(), "tmp", "loa-gbp-pilot");
const SEARCH_TERM = "roofing contractor";
const MAX_PER_SEARCH = 60;
const OFFSET_MILES = 8;
const ZOOM = 13;
const RADIUS_MILES = 15;
const CONCURRENCY = 4;

const PILOT_SLUGS = [
  "american-fork-orem-saratoga-springs-pleasant-grove-utah-provo-orem",
  "provo-orem-spanish-fork-pleasant-grove-utah-provo-orem",
  "boise-city-meridian-kuna-idaho-boise-metro",
  "nampa-meridian-caldwell-kuna-idaho-boise-metro",
  "seattle-bellevue-kirkland-shoreline-washington-seattle-tacoma",
  "billings-montana-billings",
];

type PointKey = "center" | "north" | "east" | "south" | "west";

type PlaceRow = {
  placeId?: string | null;
  title?: string | null;
  categoryName?: string | null;
  categories?: string[] | null;
  totalScore?: number | null;
  reviewsCount?: number | null;
  location?: { lat?: number; lng?: number } | null;
  permanentlyClosed?: boolean | null;
  rank?: number | null;
  [key: string]: unknown;
};

type RunRec = {
  loaSlug: string;
  loaName: string;
  point: PointKey;
  lat: number;
  lng: number;
  mapsUrl: string;
  runId: string;
  datasetId: string;
  status: string;
  usageTotalUsd: number | null;
  rawCount: number;
};

type Annotated = {
  placeId: string;
  title: string;
  loaSlug: string;
  point: PointKey;
  rankInSearch: number;
  qualify: "primary" | "roofing_secondary" | "other";
  distanceMiles: number | null;
  inRadius: boolean;
  lat: number | null;
  lng: number | null;
  reviewsCount: number | null;
  categoryName: string | null;
  permanentlyClosed: boolean;
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
  while (Date.now() - started < 45 * 60 * 1000) {
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
    await new Promise((r) => setTimeout(r, 8000));
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

function isPrimaryRoofing(p: PlaceRow): boolean {
  return (p.categoryName ?? "").trim().toLowerCase() === "roofing contractor";
}

function mentionsRoofing(p: PlaceRow): boolean {
  const cats = [
    p.categoryName ?? "",
    ...(Array.isArray(p.categories) ? p.categories : []),
  ]
    .join(" ")
    .toLowerCase();
  return cats.includes("roof");
}

function qualifyBucket(
  p: PlaceRow,
): "primary" | "roofing_secondary" | "other" {
  if (isPrimaryRoofing(p)) return "primary";
  if (mentionsRoofing(p)) return "roofing_secondary";
  return "other";
}

function saveRuns(runs: RunRec[]) {
  writeFileSync(join(OUT_DIR, "runs.json"), JSON.stringify(runs, null, 2));
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      worker(),
    ),
  );
  return results;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const token = apifyToken();
  const db = await connectAdminPg();

  const { rows: loas } = await db.query<{
    slug: string;
    display_name: string;
    center_lat: number;
    center_lng: number;
  }>(
    `select slug, display_name, center_lat::float, center_lng::float
     from local_opportunity_areas where slug = any($1::text[])`,
    [PILOT_SLUGS],
  );
  await db.end();

  if (loas.length !== PILOT_SLUGS.length) {
    console.warn(
      `Expected ${PILOT_SLUGS.length} LOAs, found ${loas.length}`,
    );
  }

  const manifestoPath = join(OUT_DIR, "runs.json");
  const runs: RunRec[] = existsSync(manifestoPath)
    ? (JSON.parse(readFileSync(manifestoPath, "utf8")) as RunRec[])
    : [];

  const pointOrder: PointKey[] = ["center", "north", "east", "south", "west"];

  type Job = {
    loa: (typeof loas)[0];
    point: PointKey;
    lat: number;
    lng: number;
    mapsUrl: string;
  };

  const jobs: Job[] = [];
  for (const loa of loas) {
    const points = buildPoints({ lat: loa.center_lat, lng: loa.center_lng });
    for (const point of pointOrder) {
      const pt = points[point];
      jobs.push({
        loa,
        point,
        lat: pt.lat,
        lng: pt.lng,
        mapsUrl: mapsSearchUrl(SEARCH_TERM, {
          lat: pt.lat,
          lng: pt.lng,
          zoom: ZOOM,
        }),
      });
    }
  }

  console.log(`Pilot jobs: ${jobs.length} (concurrency ${CONCURRENCY})`);

  await mapPool(jobs, CONCURRENCY, async (job) => {
    const existing = runs.find(
      (r) =>
        r.loaSlug === job.loa.slug &&
        r.point === job.point &&
        r.status === "SUCCEEDED",
    );
    if (existing) {
      console.log(`↺ ${job.loa.display_name} / ${job.point}`);
      return;
    }

    console.log(`→ start ${job.loa.display_name} / ${job.point}`);
    const started = await startRun(token, job.mapsUrl);
    const finished = await waitForRun(token, started.id);
    const rec: RunRec = {
      loaSlug: job.loa.slug,
      loaName: job.loa.display_name,
      point: job.point,
      lat: job.lat,
      lng: job.lng,
      mapsUrl: job.mapsUrl,
      runId: started.id,
      datasetId: finished.defaultDatasetId,
      status: finished.status,
      usageTotalUsd: finished.usageTotalUsd,
      rawCount: 0,
    };
    // replace any prior failed attempt
    const idx = runs.findIndex(
      (r) => r.loaSlug === job.loa.slug && r.point === job.point,
    );
    if (idx >= 0) runs[idx] = rec;
    else runs.push(rec);
    saveRuns(runs);
    console.log(
      `✓ ${job.loa.display_name} / ${job.point} → ${finished.status} $${finished.usageTotalUsd ?? "?"}`,
    );
  });

  // Fetch datasets + annotate
  const annotated: Annotated[] = [];
  for (const loa of loas) {
    for (const point of pointOrder) {
      const rec = runs.find(
        (r) =>
          r.loaSlug === loa.slug &&
          r.point === point &&
          r.status === "SUCCEEDED",
      );
      if (!rec) continue;
      const items = await fetchDataset(token, rec.datasetId);
      rec.rawCount = items.length;
      items.forEach((item, idx) => {
        const placeId =
          typeof item.placeId === "string" && item.placeId.trim()
            ? item.placeId.trim()
            : null;
        if (!placeId) return;
        const lat = item.location?.lat ?? null;
        const lng = item.location?.lng ?? null;
        const dist =
          lat != null && lng != null
            ? distanceMiles(
                { lat: loa.center_lat, lng: loa.center_lng },
                { lat, lng },
              )
            : null;
        const actorRank =
          typeof item.rank === "number" && item.rank > 0 ? item.rank : idx + 1;
        annotated.push({
          placeId,
          title: item.title ?? "(untitled)",
          loaSlug: loa.slug,
          point,
          rankInSearch: actorRank,
          qualify: qualifyBucket(item),
          distanceMiles: dist,
          inRadius: dist != null && dist <= RADIUS_MILES,
          lat,
          lng,
          reviewsCount:
            typeof item.reviewsCount === "number" ? item.reviewsCount : null,
          categoryName: item.categoryName ?? null,
          permanentlyClosed: Boolean(item.permanentlyClosed),
        });
      });
      console.log(`  loaded ${loa.display_name}/${point}: ${items.length}`);
    }
  }
  saveRuns(runs);
  writeFileSync(
    join(OUT_DIR, "annotated.json"),
    JSON.stringify(annotated, null, 2),
  );

  const analysis = analyze(loas, annotated, runs);
  writeFileSync(
    join(OUT_DIR, "analysis.json"),
    JSON.stringify(analysis, null, 2),
  );
  console.log("\n=== PILOT SUMMARY ===");
  console.log(JSON.stringify(analysis.summary, null, 2));
  console.log(`\nWrote ${OUT_DIR}`);
}

function analyze(
  loas: Array<{ slug: string; display_name: string }>,
  annotated: Annotated[],
  runs: RunRec[],
) {
  const pointOrder: PointKey[] = ["center", "north", "east", "south", "west"];
  const incrementalByPoint: unknown[] = [];
  const depthBuckets: unknown[] = [];
  const outsideExamples: unknown[] = [];

  for (const loa of loas) {
    const rows = annotated.filter((a) => a.loaSlug === loa.slug);
    const seen = new Set<string>();
    for (const point of pointOrder) {
      const pointRows = rows.filter((r) => r.point === point);
      let newUnique = 0;
      let newPrimary = 0;
      let newPrimaryIn = 0;
      for (const r of pointRows) {
        if (seen.has(r.placeId)) continue;
        seen.add(r.placeId);
        newUnique += 1;
        if (r.qualify === "primary") {
          newPrimary += 1;
          if (r.inRadius) newPrimaryIn += 1;
        }
      }
      incrementalByPoint.push({
        loa: loa.display_name,
        point,
        raw: pointRows.length,
        newUnique,
        newQualifiedPrimary: newPrimary,
        newInRadiusQualified: newPrimaryIn,
      });
    }

    const firstSeen = new Map<string, Annotated>();
    for (const point of pointOrder) {
      for (const r of rows.filter((x) => x.point === point)) {
        if (!firstSeen.has(r.placeId)) firstSeen.set(r.placeId, r);
      }
    }
    for (const b of [
      { label: "1-20", min: 1, max: 20 },
      { label: "21-40", min: 21, max: 40 },
      { label: "41-60", min: 41, max: 60 },
    ]) {
      const firstInBucket = [...firstSeen.values()].filter(
        (r) => r.rankInSearch >= b.min && r.rankInSearch <= b.max,
      );
      const allInBucket = rows.filter(
        (r) => r.rankInSearch >= b.min && r.rankInSearch <= b.max,
      );
      const dupes = allInBucket.filter((r) => {
        const first = firstSeen.get(r.placeId)!;
        return !(
          first.point === r.point && first.rankInSearch === r.rankInSearch
        );
      }).length;

      depthBuckets.push({
        loa: loa.display_name,
        bucket: b.label,
        firstSeenUnique: firstInBucket.length,
        firstSeenPrimary: firstInBucket.filter((r) => r.qualify === "primary")
          .length,
        firstSeenPrimaryInRadius: firstInBucket.filter(
          (r) => r.qualify === "primary" && r.inRadius,
        ).length,
        totalAppearancesInBucket: allInBucket.length,
        duplicateAppearances: dupes,
      });
    }

    const byPlace = new Map<string, Annotated[]>();
    for (const r of rows.filter((x) => x.qualify === "primary")) {
      const list = byPlace.get(r.placeId) ?? [];
      list.push(r);
      byPlace.set(r.placeId, list);
    }
    for (const [, list] of byPlace) {
      const points = new Set(list.map((l) => l.point));
      const dist = list[0]!.distanceMiles;
      if (dist != null && dist > RADIUS_MILES && points.size >= 2) {
        outsideExamples.push({
          loa: loa.display_name,
          placeId: list[0]!.placeId,
          title: list[0]!.title,
          distanceMiles: Number(dist.toFixed(1)),
          pointsAppeared: [...points],
          reviewsCount: list[0]!.reviewsCount,
          categoryName: list[0]!.categoryName,
        });
      }
    }
  }

  const rawTotal = annotated.length;
  const uniquePlaceIds = new Set(annotated.map((a) => a.placeId)).size;
  const primary = annotated.filter((a) => a.qualify === "primary");
  const primaryUnique = new Set(primary.map((a) => a.placeId)).size;
  const primaryIn = primary.filter((a) => a.inRadius);
  const primaryInUniquePairs = new Set(
    primaryIn.map((a) => `${a.loaSlug}:${a.placeId}`),
  ).size;

  let dupes = 0;
  for (const loa of loas) {
    const rows = annotated.filter((a) => a.loaSlug === loa.slug);
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.placeId)) dupes += 1;
      else seen.add(r.placeId);
    }
  }

  const costFromRuns = runs
    .filter((r) => r.status === "SUCCEEDED")
    .reduce((s, r) => s + (r.usageTotalUsd ?? 0), 0);

  // Aggregate depth value across LOAs
  const depthAgg: Record<
    string,
    { unique: number; primary: number; primaryIn: number }
  > = {
    "1-20": { unique: 0, primary: 0, primaryIn: 0 },
    "21-40": { unique: 0, primary: 0, primaryIn: 0 },
    "41-60": { unique: 0, primary: 0, primaryIn: 0 },
  };
  for (const d of depthBuckets as Array<{
    bucket: string;
    firstSeenUnique: number;
    firstSeenPrimary: number;
    firstSeenPrimaryInRadius: number;
  }>) {
    const a = depthAgg[d.bucket];
    if (!a) continue;
    a.unique += d.firstSeenUnique;
    a.primary += d.firstSeenPrimary;
    a.primaryIn += d.firstSeenPrimaryInRadius;
  }

  // Point contribution totals
  const pointAgg: Record<
    string,
    { newUnique: number; newPrimary: number; newPrimaryIn: number }
  > = {};
  for (const p of pointOrder) {
    pointAgg[p] = { newUnique: 0, newPrimary: 0, newPrimaryIn: 0 };
  }
  for (const row of incrementalByPoint as Array<{
    point: string;
    newUnique: number;
    newQualifiedPrimary: number;
    newInRadiusQualified: number;
  }>) {
    const a = pointAgg[row.point]!;
    a.newUnique += row.newUnique;
    a.newPrimary += row.newQualifiedPrimary;
    a.newPrimaryIn += row.newInRadiusQualified;
  }

  return {
    summary: {
      pilotLoas: loas.length,
      searchPointsPerLoa: 5,
      maxPerSearch: MAX_PER_SEARCH,
      totalApifyRuns: runs.filter((r) => r.status === "SUCCEEDED").length,
      apifyCostUsd: Number(costFromRuns.toFixed(4)),
      rawResults: rawTotal,
      uniquePlaceIds,
      uniquePrimaryRoofing: primaryUnique,
      inRadiusPrimaryMemberships: primaryInUniquePairs,
      outsideRadiusPrimaryAppearances: primary.filter((a) => !a.inRadius)
        .length,
      outsideRadiusPrimaryUnique: new Set(
        primary.filter((a) => !a.inRadius).map((a) => a.placeId),
      ).size,
      outsideShareOfPrimaryAppearances:
        primary.length > 0
          ? Number(
              (primary.filter((a) => !a.inRadius).length / primary.length).toFixed(
                3,
              ),
            )
          : null,
      crossPointDuplicateAppearances: dupes,
      duplicateRate: rawTotal > 0 ? Number((dupes / rawTotal).toFixed(3)) : null,
      pointContributionTotals: pointAgg,
      depthContributionTotals: depthAgg,
    },
    incrementalByPoint,
    depthBuckets,
    outsideExamples: (
      outsideExamples as Array<{ distanceMiles: number; pointsAppeared: string[] }>
    )
      .sort(
        (a, b) =>
          b.pointsAppeared.length - a.pointsAppeared.length ||
          a.distanceMiles - b.distanceMiles,
      )
      .slice(0, 30),
    runs: runs.map((r) => ({
      loa: r.loaName,
      point: r.point,
      raw: r.rawCount,
      cost: r.usageTotalUsd,
      status: r.status,
      runId: r.runId,
    })),
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
