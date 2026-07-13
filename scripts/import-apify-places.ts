/**
 * Import Apify Google Maps dataset into Supabase for exactly one market.
 * Usage:
 *   tsx scripts/import-apify-places.ts <dataset.json> --market=boise-metro
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "dotenv";
import { Client } from "pg";
import {
  DEFAULT_REVIEW_THRESHOLD,
  qualifyRoofingBusiness,
} from "../src/lib/qualification";
import { getMarket, isInMarket, type MarketDefinition } from "../src/lib/markets";

config({ path: ".env.local" });

type ApifyPlace = {
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
  searchString?: string | null;
  locationQuery?: string | null;
};

type Rejection = {
  placeId?: string | null;
  title?: string | null;
  city?: string | null;
  reason: string;
};

type ImportReport = {
  marketId: string;
  marketName: string;
  placesReturned: number;
  businessesAccepted: number;
  businessesRejected: number;
  businessesCreated: number;
  businessesUpdated: number;
  snapshotsCreated: number;
  snapshotsUpdated: number;
  duplicatesSkipped: number;
  rejected: Rejection[];
  failedRecords: { placeId?: string | null; title?: string | null; error: string }[];
  missingFields: Record<string, number>;
  reviewsCountPopulated: number;
  reviewsCountMissing: number;
  samplesAccepted: Record<string, unknown>[];
};

async function connectClient(): Promise<Client> {
  const password = process.env.SUPABASE_DATABASE_PASS;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!password || !supabaseUrl) {
    throw new Error("Missing SUPABASE_DATABASE_PASS or NEXT_PUBLIC_SUPABASE_URL");
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const encoded = encodeURIComponent(password);
  const urls = [
    process.env.SUPABASE_DB_URL,
    `postgresql://postgres.${projectRef}:${encoded}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
  ].filter(Boolean) as string[];

  let lastError: unknown;
  for (const connectionString of urls) {
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DB connect failed");
}

function parseArgs(argv: string[]) {
  const path = argv.find((a) => !a.startsWith("--"));
  const marketId = argv.find((a) => a.startsWith("--market="))?.split("=")[1];
  if (!path || !marketId) {
    throw new Error(
      "Usage: tsx scripts/import-apify-places.ts <dataset.json> --market=boise-metro",
    );
  }
  return { path, market: getMarket(marketId) };
}

function trackMissing(place: ApifyPlace, missing: Record<string, number>) {
  const checks: [string, unknown][] = [
    ["title", place.title],
    ["placeId", place.placeId],
    ["categoryName", place.categoryName],
    ["address", place.address],
    ["city", place.city],
    ["state", place.state],
    ["postalCode", place.postalCode],
    ["phone", place.phone],
    ["website", place.website],
    ["totalScore", place.totalScore],
    ["reviewsCount", place.reviewsCount],
    ["location.lat", place.location?.lat],
    ["location.lng", place.location?.lng],
    ["url", place.url],
  ];
  for (const [key, value] of checks) {
    if (value === null || value === undefined || value === "") {
      missing[key] = (missing[key] ?? 0) + 1;
    }
  }
}

async function main() {
  const { path, market } = parseArgs(process.argv.slice(2));
  const places = JSON.parse(readFileSync(path, "utf8")) as ApifyPlace[];

  const report: ImportReport = {
    marketId: market.id,
    marketName: market.name,
    placesReturned: places.length,
    businessesAccepted: 0,
    businessesRejected: 0,
    businessesCreated: 0,
    businessesUpdated: 0,
    snapshotsCreated: 0,
    snapshotsUpdated: 0,
    duplicatesSkipped: 0,
    rejected: [],
    failedRecords: [],
    missingFields: {},
    reviewsCountPopulated: 0,
    reviewsCountMissing: 0,
    samplesAccepted: [],
  };

  const seen = new Set<string>();
  const client = await connectClient();

  try {
    await client.query("begin");

    const scrapeRun = await client.query<{ id: string }>(
      `insert into public.scrape_runs (
        source, query, city, state, category, status, records_found, started_at, market_id
      ) values ($1, $2, $3, $4, $5, $6, $7, now(), $8)
      returning id`,
      [
        "google_apify",
        `roofing contractor @ ${market.id}`,
        market.name,
        market.state,
        "roofing contractor",
        "running",
        places.length,
        market.id,
      ],
    );
    const scrapeRunId = scrapeRun.rows[0].id;

    for (const place of places) {
      trackMissing(place, report.missingFields);

      if (place.reviewsCount === null || place.reviewsCount === undefined) {
        report.reviewsCountMissing += 1;
      } else {
        report.reviewsCountPopulated += 1;
      }

      if (!place.placeId || !place.title) {
        report.failedRecords.push({
          placeId: place.placeId,
          title: place.title,
          error: "Missing required placeId or title",
        });
        continue;
      }

      if (seen.has(place.placeId)) {
        report.duplicatesSkipped += 1;
        continue;
      }
      seen.add(place.placeId);

      const membership = isInMarket(market, {
        city: place.city,
        latitude: place.location?.lat ?? null,
        longitude: place.location?.lng ?? null,
      });

      if (!membership.ok) {
        report.businessesRejected += 1;
        report.rejected.push({
          placeId: place.placeId,
          title: place.title,
          city: place.city ?? null,
          reason: membership.reason,
        });
        console.warn(
          `[reject] ${place.title} (${place.city ?? "no city"}): ${membership.reason}`,
        );
        continue;
      }

      try {
        const acceptedCity = membership.city;
        const existing = await client.query<{ id: string }>(
          `select id from public.businesses where google_place_id = $1`,
          [place.placeId],
        );
        const isUpdate = existing.rows.length > 0;

        const { rows } = await client.query<{ id: string }>(
          `insert into public.businesses (
            google_place_id, name, primary_category, secondary_categories,
            website_url, phone, address, city, state, postal_code, country,
            latitude, longitude, google_maps_url, is_active, last_seen_at, market_id
          ) values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
            $15, now(), $16
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
            acceptedCity,
            place.state ?? null,
            place.postalCode ?? null,
            place.countryCode ?? "US",
            place.location?.lat ?? null,
            place.location?.lng ?? null,
            place.url ?? null,
            !(place.permanentlyClosed || place.temporarilyClosed),
            market.id,
          ],
        );

        const businessId = rows[0].id;
        report.businessesAccepted += 1;
        if (isUpdate) {
          report.businessesUpdated += 1;
        } else {
          report.businessesCreated += 1;
        }

        const snapshot = await client.query(
          `insert into public.review_snapshots (
            business_id, snapshot_date, review_count, average_rating, source
          ) values ($1, current_date, $2, $3, 'google_apify')
          on conflict (business_id, snapshot_date, source) do update set
            review_count = excluded.review_count,
            average_rating = excluded.average_rating
          returning (xmax = 0) as inserted`,
          [businessId, place.reviewsCount ?? null, place.totalScore ?? null],
        );

        if (snapshot.rows[0]?.inserted) {
          report.snapshotsCreated += 1;
        } else {
          report.snapshotsUpdated += 1;
        }

        await applyQualification(client, businessId, place, market);

        if (report.samplesAccepted.length < 5) {
          report.samplesAccepted.push({
            id: businessId,
            name: place.title,
            city: acceptedCity,
            primary_category: place.categoryName,
            review_count: place.reviewsCount,
          });
        }
      } catch (error) {
        report.failedRecords.push({
          placeId: place.placeId,
          title: place.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await client.query(
      `update public.scrape_runs set
        status = $2,
        finished_at = now(),
        records_found = $3,
        records_created = $4,
        records_updated = $5
      where id = $1`,
      [
        scrapeRunId,
        report.failedRecords.length ? "completed_with_errors" : "completed",
        report.placesReturned,
        report.businessesCreated,
        report.businessesUpdated,
      ],
    );

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }

  const outPath = path.replace(/\.json$/i, "-import-report.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        marketId: report.marketId,
        placesReturned: report.placesReturned,
        businessesAccepted: report.businessesAccepted,
        businessesRejected: report.businessesRejected,
        businessesCreated: report.businessesCreated,
        businessesUpdated: report.businessesUpdated,
        rejected: report.rejected,
        reportPath: outPath,
      },
      null,
      2,
    ),
  );
}

async function applyQualification(
  client: Client,
  businessId: string,
  place: ApifyPlace,
  _market: MarketDefinition,
) {
  const reviewThreshold = Number(
    process.env.VEZZT_MIN_REVIEW_COUNT ?? DEFAULT_REVIEW_THRESHOLD,
  );
  const qualification = qualifyRoofingBusiness(
    {
      name: place.title!,
      primaryCategory: place.categoryName ?? null,
      secondaryCategories: place.categories?.length ? place.categories : null,
      websiteUrl: place.website ?? null,
      reviewCount: place.reviewsCount ?? null,
    },
    Number.isFinite(reviewThreshold) ? reviewThreshold : DEFAULT_REVIEW_THRESHOLD,
  );

  await client.query(
    `update public.businesses set
      is_qualified = $2,
      qualification_reason = $3,
      qualification_confidence = $4,
      target_sector = $5,
      review_threshold_met = $6,
      qualification_status = $7,
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
    ],
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
