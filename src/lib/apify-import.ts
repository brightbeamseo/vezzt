import { Client } from "pg";
import {
  DEFAULT_REVIEW_THRESHOLD,
  qualifyRoofingBusiness,
} from "@/lib/qualification";
import { resolveMarketUuid } from "@/lib/census/market-enrichment";
import { getMarket, isInMarket } from "@/lib/markets";
import { assignMonitoringTier } from "@/lib/monitoring";
import { connectAdminPg } from "@/lib/admin-db";

export type ApifyPlace = {
  title?: string | null;
  placeId?: string | null;
  categoryName?: string | null;
  categories?: string[] | null;
  address?: string | null;
  street?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
  phone?: string | null;
  website?: string | null;
  totalScore?: number | null;
  reviewsCount?: number | null;
  url?: string | null;
  location?: { lat?: number | null; lng?: number | null } | null;
  permanentlyClosed?: boolean | null;
  temporarilyClosed?: boolean | null;
};

export type ApifyImportStats = {
  marketId: string;
  mode: "discovery" | "monitor";
  apifyRunId: string | null;
  datasetId: string | null;
  scrapeRunId: string | null;
  placesReturned: number;
  created: number;
  updated: number;
  skippedDuplicates: number;
  skippedUnknownPlaceIds: number;
  snapshotsCreated: number;
  snapshotsSkippedDuplicate: number;
  rejectedOutsideMarket: number;
  rejectedClosed: number;
  sectorExcluded: number;
  failed: number;
  failedRecords: { placeId?: string | null; title?: string | null; error: string }[];
  status: "completed" | "completed_with_errors" | "failed";
  /** Discovery-only: only insert Roofing contractor rows (non-qualifiers go to rejections). */
  qualifyingOnly: boolean;
};

function apifyToken(): string {
  // On Vercel, platform env vars are authoritative.
  if (process.env.VERCEL) {
    const token =
      process.env.APIFY_TOKEN || process.env.APIFY_DEFAULT_API_TOKEN || "";
    if (!token) throw new Error("Missing APIFY_TOKEN");
    return token;
  }

  // Locally, read .env.local directly to avoid secret-injection overlays.
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
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

export async function fetchApifyRun(runId: string): Promise<{
  id: string;
  status: string;
  defaultDatasetId: string;
  startedAt?: string;
  finishedAt?: string;
}> {
  const res = await fetch(
    `https://api.apify.com/v2/actor-runs/${runId}?token=${encodeURIComponent(apifyToken())}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch Apify run ${runId}: ${res.status}`);
  }
  const json = (await res.json()) as {
    data: {
      id: string;
      status: string;
      defaultDatasetId: string;
      startedAt?: string;
      finishedAt?: string;
    };
  };
  return json.data;
}

export async function fetchApifyDatasetItems(
  datasetId: string,
): Promise<ApifyPlace[]> {
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
      throw new Error(`Failed to fetch dataset ${datasetId}: ${res.status}`);
    }
    const batch = (await res.json()) as ApifyPlace[];
    items.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return items;
}

/**
 * Import Apify places into Supabase for a market.
 * Uniqueness is always enforced via google_place_id (UNIQUE + ON CONFLICT).
 *
 * discovery: upsert by placeId; qualify by primary category; log excludes
 * monitor: update existing placeIds only — never insert new businesses
 */
export async function importApifyPlaces(options: {
  places: ApifyPlace[];
  marketId?: string;
  apifyRunId?: string | null;
  datasetId?: string | null;
  snapshotDate?: string; // YYYY-MM-DD; defaults to today (UTC)
  mode?: "discovery" | "monitor";
  /**
   * When true (default for discovery), only Roofing contractor rows are written
   * to businesses. Wrong category / closed are logged to collection_rejections.
   */
  qualifyingOnly?: boolean;
  client?: Client;
}): Promise<ApifyImportStats> {
  const market = getMarket(options.marketId ?? "boise-metro");
  const mode = options.mode ?? "discovery";
  const qualifyingOnly =
    options.qualifyingOnly ?? mode === "discovery";
  const snapshotDate =
    options.snapshotDate ?? new Date().toISOString().slice(0, 10);
  const ownsClient = !options.client;
  const client = options.client ?? (await connectAdminPg());
  const marketUuid = await resolveMarketUuid(client, market.id);

  const stats: ApifyImportStats = {
    marketId: market.id,
    mode,
    apifyRunId: options.apifyRunId ?? null,
    datasetId: options.datasetId ?? null,
    scrapeRunId: null,
    placesReturned: options.places.length,
    created: 0,
    updated: 0,
    skippedDuplicates: 0,
    skippedUnknownPlaceIds: 0,
    snapshotsCreated: 0,
    snapshotsSkippedDuplicate: 0,
    rejectedOutsideMarket: 0,
    rejectedClosed: 0,
    sectorExcluded: 0,
    failed: 0,
    failedRecords: [],
    status: "completed",
    qualifyingOnly,
  };

  const seen = new Set<string>();

  try {
    await client.query("begin");

    const scrapeRun = await client.query<{ id: string }>(
      `insert into public.scrape_runs (
        source, query, city, state, category, status, records_found,
        started_at, market_id
      ) values ($1, $2, $3, $4, $5, $6, $7, now(), $8)
      returning id`,
      [
        "google_apify",
        options.apifyRunId
          ? `${mode}:${options.apifyRunId}`
          : `${mode}:${market.id}`,
        market.name,
        market.state,
        mode === "monitor" ? "roofing_monitor" : "roofing_discovery",
        "running",
        options.places.length,
        market.id,
      ],
    );
    stats.scrapeRunId = scrapeRun.rows[0].id;

    for (const place of options.places) {
      try {
        if (!place.placeId || !place.title) {
          stats.failed += 1;
          stats.failedRecords.push({
            placeId: place.placeId,
            title: place.title,
            error: "Missing placeId or title",
          });
          continue;
        }

        if (seen.has(place.placeId)) {
          stats.skippedDuplicates += 1;
          continue;
        }
        seen.add(place.placeId);

        const membership = isInMarket(market, {
          city: place.city,
          latitude: place.location?.lat ?? null,
          longitude: place.location?.lng ?? null,
        });

        if (!membership.ok) {
          stats.rejectedOutsideMarket += 1;
          await client.query(
            `insert into public.collection_rejections (
              market_id, google_place_id, name, city, primary_category,
              rejection_stage, reason, source, scrape_run_id, raw
            ) values ($1,$2,$3,$4,$5,'market',$6,'google_apify',$7,$8::jsonb)`,
            [
              market.id,
              place.placeId,
              place.title,
              place.city ?? null,
              place.categoryName ?? null,
              membership.reason,
              stats.scrapeRunId,
              JSON.stringify(place),
            ],
          );
          continue;
        }

        if (place.permanentlyClosed) {
          stats.rejectedClosed += 1;
          await client.query(
            `insert into public.collection_rejections (
              market_id, google_place_id, name, city, primary_category,
              rejection_stage, reason, source, scrape_run_id, raw
            ) values ($1,$2,$3,$4,$5,'invalid',$6,'google_apify',$7,$8::jsonb)`,
            [
              market.id,
              place.placeId,
              place.title,
              place.city ?? null,
              place.categoryName ?? null,
              "Permanently closed",
              stats.scrapeRunId,
              JSON.stringify(place),
            ],
          );
          continue;
        }

        const reviewThreshold = Number(
          process.env.VEZZT_MIN_REVIEW_COUNT ?? DEFAULT_REVIEW_THRESHOLD,
        );
        const qualification = qualifyRoofingBusiness(
          {
            name: place.title,
            primaryCategory: place.categoryName ?? null,
            secondaryCategories: place.categories?.length
              ? place.categories
              : null,
            websiteUrl: place.website ?? null,
            reviewCount: place.reviewsCount ?? null,
          },
          Number.isFinite(reviewThreshold)
            ? reviewThreshold
            : DEFAULT_REVIEW_THRESHOLD,
        );

        if (
          qualifyingOnly &&
          qualification.qualificationStatus === "excluded"
        ) {
          stats.sectorExcluded += 1;
          await client.query(
            `insert into public.collection_rejections (
              market_id, google_place_id, name, city, primary_category,
              rejection_stage, reason, source, scrape_run_id, raw
            ) values ($1,$2,$3,$4,$5,'sector',$6,'google_apify',$7,$8::jsonb)`,
            [
              market.id,
              place.placeId,
              place.title,
              place.city ?? null,
              place.categoryName ?? null,
              qualification.qualificationReason,
              stats.scrapeRunId,
              JSON.stringify(place),
            ],
          );
          continue;
        }

        const existing = await client.query<{ id: string }>(
          `select id from public.businesses where google_place_id = $1`,
          [place.placeId],
        );
        const isUpdate = existing.rows.length > 0;

        // Monitoring never creates new businesses — only known Place IDs.
        if (mode === "monitor" && !isUpdate) {
          stats.skippedUnknownPlaceIds += 1;
          continue;
        }

        const { rows } = await client.query<{ id: string }>(
          `insert into public.businesses (
            google_place_id, name, primary_category, secondary_categories,
            website_url, phone, address, city, state, postal_code, country,
            latitude, longitude, google_maps_url, is_active, last_seen_at, market_id
          ) values (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),$16
          )
          on conflict (google_place_id) do update set
            name = excluded.name,
            primary_category = excluded.primary_category,
            secondary_categories = excluded.secondary_categories,
            website_url = excluded.website_url,
            phone = excluded.phone,
            address = excluded.address,
            city = excluded.city,
            state = excluded.state,
            postal_code = excluded.postal_code,
            country = excluded.country,
            latitude = excluded.latitude,
            longitude = excluded.longitude,
            google_maps_url = excluded.google_maps_url,
            is_active = excluded.is_active,
            market_id = excluded.market_id,
            last_seen_at = now(),
            updated_at = now()
          returning id`,
          [
            place.placeId,
            place.title,
            place.categoryName ?? null,
            place.categories?.length ? place.categories : null,
            place.website ?? null,
            place.phone ?? null,
            place.address ?? place.street ?? null,
            membership.city,
            place.state ?? null,
            place.postalCode ?? null,
            place.countryCode ?? "US",
            place.location?.lat ?? null,
            place.location?.lng ?? null,
            place.url ?? null,
            !(place.permanentlyClosed || place.temporarilyClosed),
            marketUuid,
          ],
        );

        const businessId = rows[0].id;
        if (isUpdate) stats.updated += 1;
        else stats.created += 1;

        const snap = await client.query<{ inserted: boolean }>(
          `insert into public.review_snapshots (
            business_id, snapshot_date, review_count, average_rating, source
          ) values ($1, $2::date, $3, $4, 'google_apify')
          on conflict (business_id, snapshot_date, source) do nothing
          returning (xmax = 0) as inserted`,
          [
            businessId,
            snapshotDate,
            place.reviewsCount ?? null,
            place.totalScore ?? null,
          ],
        );

        if (snap.rowCount && snap.rowCount > 0) {
          stats.snapshotsCreated += 1;
        } else {
          stats.snapshotsSkippedDuplicate += 1;
        }

        const isRoofing = qualification.targetSector === "roofing";
        if (
          !qualifyingOnly &&
          qualification.qualificationStatus === "excluded"
        ) {
          stats.sectorExcluded += 1;
          if (mode === "discovery") {
            await client.query(
              `insert into public.collection_rejections (
                market_id, google_place_id, name, city, primary_category,
                rejection_stage, reason, source, scrape_run_id, raw
              ) values ($1,$2,$3,$4,$5,'sector',$6,'google_apify',$7,$8::jsonb)`,
              [
                market.id,
                place.placeId,
                place.title,
                place.city ?? null,
                place.categoryName ?? null,
                qualification.qualificationReason,
                stats.scrapeRunId,
                JSON.stringify(place),
              ],
            );
          }
        }
        const monitoring = assignMonitoringTier(
          place.reviewsCount ?? null,
          isRoofing,
        );

        await client.query(
          `update public.businesses set
            is_qualified = $2,
            qualification_reason = $3,
            qualification_confidence = $4,
            target_sector = $5,
            review_threshold_met = $6,
            qualification_status = $7,
            monitoring_tier = $8,
            monitoring_frequency = $9,
            last_monitored_at = case when $11::boolean then now() else coalesce(last_monitored_at, now()) end,
            next_monitor_at = case
              when $11::boolean then $10
              else coalesce(next_monitor_at, $10)
            end,
            updated_at = now()
          where id = $1`,
          [
            businessId,
            qualification.isQualified,
            qualification.qualificationReason,
            qualification.qualificationConfidence,
            qualification.targetSector,
            qualification.reviewThresholdMet,
            qualification.qualificationStatus,
            monitoring.monitoringTier,
            monitoring.monitoringFrequency,
            monitoring.nextMonitorAt,
            mode === "monitor",
          ],
        );
      } catch (error) {
        stats.failed += 1;
        stats.failedRecords.push({
          placeId: place.placeId,
          title: place.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    stats.status =
      stats.failed > 0 ? "completed_with_errors" : "completed";

    await client.query(
      `update public.scrape_runs set
        status = $2,
        finished_at = now(),
        records_found = $3,
        records_created = $4,
        records_updated = $5
      where id = $1`,
      [
        stats.scrapeRunId,
        stats.status,
        stats.placesReturned,
        stats.created,
        stats.updated,
      ],
    );

    await client.query("commit");
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // ignore
    }
    stats.status = "failed";
    throw error;
  } finally {
    if (ownsClient) await client.end();
  }

  return stats;
}

export async function importApifyRunToSupabase(options: {
  runId: string;
  datasetId?: string | null;
  marketId?: string;
  mode?: "discovery" | "monitor";
}): Promise<ApifyImportStats> {
  const run = await fetchApifyRun(options.runId);
  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ${options.runId} status is ${run.status}`);
  }
  const datasetId = options.datasetId || run.defaultDatasetId;
  if (!datasetId) {
    throw new Error(`No dataset ID for run ${options.runId}`);
  }

  const places = await fetchApifyDatasetItems(datasetId);
  const finishedDate = run.finishedAt
    ? run.finishedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  return importApifyPlaces({
    places,
    marketId: options.marketId ?? "boise-metro",
    apifyRunId: run.id,
    datasetId,
    snapshotDate: finishedDate,
    mode: options.mode ?? "discovery",
  });
}
