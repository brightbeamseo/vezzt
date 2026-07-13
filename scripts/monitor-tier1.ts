/**
 * Monitor Tier 1 businesses by known Place ID / Google Maps URL.
 * Does NOT run broad discovery. Not scheduled — invoke manually.
 *
 * Usage: tsx scripts/monitor-tier1.ts --market=boise-metro
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { getMarket } from "../src/lib/markets";
import { nextMonitorDate } from "../src/lib/monitoring";
import { connectSupabasePg } from "./db";

config({ path: ".env.local" });

type ApifyPlace = {
  placeId?: string;
  title?: string;
  totalScore?: number | null;
  reviewsCount?: number | null;
  permanentlyClosed?: boolean | null;
  temporarilyClosed?: boolean | null;
  url?: string | null;
};

function apifyToken(): string {
  const token =
    process.env.APIFY_DEFAULT_API_TOKEN || process.env.APIFY_TOKEN || "";
  if (!token) throw new Error("Missing APIFY_DEFAULT_API_TOKEN");
  return token;
}

async function scrapeByPlaceIds(
  token: string,
  placeIds: string[],
): Promise<{ runId: string; items: ApifyPlace[]; usageTotalUsd: number | null }> {
  const searchStringsArray = placeIds.map((id) => `place_id:${id}`);
  const start = await fetch(
    `https://api.apify.com/v2/acts/compass~crawler-google-places/runs?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray,
        maxCrawledPlacesPerSearch: 1,
        language: "en",
        scrapePlaceDetailPage: true,
        maxReviews: 0,
        maxImages: 0,
      }),
    },
  );
  if (!start.ok) {
    throw new Error(`Start monitor run failed: ${start.status} ${await start.text()}`);
  }
  const started = (await start.json()) as {
    data: { id: string; defaultDatasetId: string };
  };
  const runId = started.data.id;

  const deadline = Date.now() + 20 * 60 * 1000;
  let datasetId = started.data.defaultDatasetId;
  let usageTotalUsd: number | null = null;
  while (Date.now() < deadline) {
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(token)}`,
    );
    const json = (await res.json()) as {
      data: { status: string; defaultDatasetId: string; usageTotalUsd?: number };
    };
    if (
      ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(json.data.status)
    ) {
      if (json.data.status !== "SUCCEEDED") {
        throw new Error(`Monitor run ${runId} status ${json.data.status}`);
      }
      datasetId = json.data.defaultDatasetId;
      usageTotalUsd =
        typeof json.data.usageTotalUsd === "number"
          ? json.data.usageTotalUsd
          : null;
      break;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }

  const itemsRes = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${encodeURIComponent(token)}&format=json&clean=true`,
  );
  const items = (await itemsRes.json()) as ApifyPlace[];
  return { runId, items, usageTotalUsd };
}

async function main() {
  const marketId =
    process.argv.find((a) => a.startsWith("--market="))?.split("=")[1] ??
    "boise-metro";
  const market = getMarket(marketId);
  const dryRun = process.argv.includes("--dry-run");
  const client = await connectSupabasePg();
  const token = apifyToken();

  try {
    const { rows } = await client.query<{
      id: string;
      name: string;
      google_place_id: string;
      google_maps_url: string | null;
    }>(
      `select id, name, google_place_id, google_maps_url
       from public.businesses
       where market_id = $1
         and monitoring_tier = 1
         and google_place_id is not null
       order by name`,
      [market.id],
    );

    if (rows.length === 0) {
      console.log(JSON.stringify({ marketId: market.id, tier1: 0, message: "No Tier 1 businesses" }));
      return;
    }

    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            marketId: market.id,
            dryRun: true,
            tier1Count: rows.length,
            businesses: rows.map((r) => ({
              name: r.name,
              placeId: r.google_place_id,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }

    const { runId, items, usageTotalUsd } = await scrapeByPlaceIds(
      token,
      rows.map((r) => r.google_place_id),
    );

    const byPlace = new Map(items.map((i) => [i.placeId, i]));
    let snapshots = 0;
    const now = new Date();
    const next = nextMonitorDate("weekly", now);

    await client.query("begin");
    for (const row of rows) {
      const place = byPlace.get(row.google_place_id);
      if (!place) continue;

      const snap = await client.query(
        `insert into public.review_snapshots (
          business_id, snapshot_date, review_count, average_rating, source
        ) values ($1, current_date, $2, $3, 'google_apify_monitor')
        on conflict (business_id, snapshot_date, source) do update set
          review_count = excluded.review_count,
          average_rating = excluded.average_rating
        returning (xmax = 0) as inserted`,
        [row.id, place.reviewsCount ?? null, place.totalScore ?? null],
      );
      if (snap.rows[0]?.inserted) snapshots += 1;

      const isActive = !(place.permanentlyClosed || place.temporarilyClosed);
      await client.query(
        `update public.businesses set
          is_active = $2,
          google_maps_url = coalesce($3, google_maps_url),
          last_monitored_at = $4,
          next_monitor_at = $5,
          last_seen_at = now(),
          updated_at = now()
        where id = $1`,
        [row.id, isActive, place.url ?? null, now, next],
      );
    }
    await client.query("commit");

    const report = {
      marketId: market.id,
      runId,
      tier1Monitored: rows.length,
      snapshotsWritten: snapshots,
      usageTotalUsd,
      nextMonitorAt: next.toISOString(),
    };
    writeFileSync(
      `tmp/${market.id}-tier1-monitor-report.json`,
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
