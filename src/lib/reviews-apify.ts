/**
 * Apify Google Maps Reviews Scraper helpers.
 * Actor: compass/google-maps-reviews-scraper
 */

export const REVIEWS_ACTOR_ID = "compass/google-maps-reviews-scraper";
export const REVIEWS_ACTOR_API = "compass~google-maps-reviews-scraper";
export const REVIEW_PROVIDER = "google_apify";

export type ApifyReviewItem = {
  reviewId?: string | null;
  reviewUrl?: string | null;
  placeId?: string | null;
  publishedAtDate?: string | null;
  publishAt?: string | null;
  stars?: number | null;
  rating?: number | null;
  text?: string | null;
  name?: string | null;
  reviewerUrl?: string | null;
  responseFromOwnerText?: string | null;
  responseFromOwnerDate?: string | null;
  reviewsCount?: number | null;
  title?: string | null;
  // Place-level rows sometimes appear without reviewId
  [key: string]: unknown;
};

export type ReviewsRunResult = {
  runId: string;
  datasetId: string;
  status: string;
  usageTotalUsd: number | null;
  chargedEventCounts: Record<string, number> | null;
  items: ApifyReviewItem[];
};

function apifyToken(): string {
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

export function getApifyToken(): string {
  return apifyToken();
}

export async function startReviewsScrape(input: {
  placeId: string;
  maxReviews?: number;
}): Promise<{ id: string; defaultDatasetId: string }> {
  const token = apifyToken();
  const body: Record<string, unknown> = {
    placeIds: [input.placeId],
    reviewsSort: "newest",
    language: "en",
    personalData: false,
  };
  if (typeof input.maxReviews === "number") {
    body.maxReviews = input.maxReviews;
  } else {
    body.maxReviews = 99999;
  }

  const res = await fetch(
    `https://api.apify.com/v2/acts/${REVIEWS_ACTOR_API}/runs?token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(`Start reviews run failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    data: { id: string; defaultDatasetId: string };
  };
  return json.data;
}

export async function waitForReviewsRun(
  runId: string,
  timeoutMs = 60 * 60 * 1000,
): Promise<{
  status: string;
  defaultDatasetId: string;
  usageTotalUsd: number | null;
  chargedEventCounts: Record<string, number> | null;
}> {
  const token = apifyToken();
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
        chargedEventCounts?: Record<string, number>;
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
        chargedEventCounts: json.data.chargedEventCounts ?? null,
      };
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`Timed out waiting for reviews run ${runId}`);
}

export async function fetchAllDatasetItems(
  datasetId: string,
): Promise<ApifyReviewItem[]> {
  const token = apifyToken();
  const all: ApifyReviewItem[] = [];
  const limit = 1000;
  let offset = 0;

  for (;;) {
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
      throw new Error(`Dataset fetch failed: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as ApifyReviewItem[];
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }

  return all;
}

export async function scrapeGoogleReviews(input: {
  placeId: string;
  maxReviews?: number;
  existingRunId?: string;
}): Promise<ReviewsRunResult> {
  let runId = input.existingRunId;
  let datasetId: string;

  if (runId) {
    const finished = await waitForReviewsRun(runId);
    if (finished.status !== "SUCCEEDED") {
      throw new Error(`Reviews run ${runId} ended with status ${finished.status}`);
    }
    datasetId = finished.defaultDatasetId;
    const items = await fetchAllDatasetItems(datasetId);
    return {
      runId,
      datasetId,
      status: finished.status,
      usageTotalUsd: finished.usageTotalUsd,
      chargedEventCounts: finished.chargedEventCounts,
      items,
    };
  }

  const started = await startReviewsScrape({
    placeId: input.placeId,
    maxReviews: input.maxReviews,
  });
  runId = started.id;
  const finished = await waitForReviewsRun(runId);
  if (finished.status !== "SUCCEEDED") {
    throw new Error(`Reviews run ${runId} ended with status ${finished.status}`);
  }
  datasetId = finished.defaultDatasetId;
  const items = await fetchAllDatasetItems(datasetId);
  return {
    runId,
    datasetId,
    status: finished.status,
    usageTotalUsd: finished.usageTotalUsd,
    chargedEventCounts: finished.chargedEventCounts,
    items,
  };
}

/** Flatten dataset rows into unique reviews (one row per reviewId). */
export function flattenApifyReviewItems(
  items: ApifyReviewItem[],
): ApifyReviewItem[] {
  const byId = new Map<string, ApifyReviewItem>();

  for (const item of items) {
    const reviewId =
      typeof item.reviewId === "string" && item.reviewId.trim()
        ? item.reviewId.trim()
        : null;
    if (!reviewId) continue;

    // Prefer the first occurrence; later duplicates from split place rows are skipped
    if (!byId.has(reviewId)) {
      byId.set(reviewId, item);
    }
  }

  return Array.from(byId.values());
}

export function parsePublishedAt(item: ApifyReviewItem): Date | null {
  if (typeof item.publishedAtDate === "string" && item.publishedAtDate.trim()) {
    const d = new Date(item.publishedAtDate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function parseOwnerResponseDate(item: ApifyReviewItem): Date | null {
  if (
    typeof item.responseFromOwnerDate === "string" &&
    item.responseFromOwnerDate.trim()
  ) {
    const d = new Date(item.responseFromOwnerDate);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

export function parseRating(item: ApifyReviewItem): number | null {
  if (typeof item.stars === "number" && Number.isFinite(item.stars)) {
    return item.stars;
  }
  if (typeof item.rating === "number" && Number.isFinite(item.rating)) {
    return item.rating;
  }
  return null;
}
