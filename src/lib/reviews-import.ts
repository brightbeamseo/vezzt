import type { Client } from "pg";
import {
  REVIEW_PROVIDER,
  flattenApifyReviewItems,
  parseOwnerResponseDate,
  parsePublishedAt,
  parseRating,
  type ApifyReviewItem,
} from "@/lib/reviews-apify";

export type ReviewImportStats = {
  datasetRows: number;
  uniqueReviews: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  failures: { reviewId: string; error: string }[];
};

export type ReviewRowInput = {
  businessId: string;
  googlePlaceId: string | null;
  providerReviewId: string;
  publishedAt: Date;
  rating: number | null;
  reviewText: string | null;
  reviewerName: string | null;
  reviewerUrl: string | null;
  ownerResponseText: string | null;
  ownerResponseDate: Date | null;
  rawResponse: ApifyReviewItem;
};

export function mapApifyItemToReview(
  item: ApifyReviewItem,
  businessId: string,
  googlePlaceId: string | null,
): ReviewRowInput | null {
  const providerReviewId =
    typeof item.reviewId === "string" ? item.reviewId.trim() : "";
  if (!providerReviewId) return null;

  const publishedAt = parsePublishedAt(item);
  if (!publishedAt) return null;

  const rating = parseRating(item);
  // Rating is required minimum — skip if missing
  if (rating === null) return null;

  const ownerText =
    typeof item.responseFromOwnerText === "string" &&
    item.responseFromOwnerText.trim()
      ? item.responseFromOwnerText.trim()
      : null;

  return {
    businessId,
    googlePlaceId:
      (typeof item.placeId === "string" && item.placeId) || googlePlaceId,
    providerReviewId,
    publishedAt,
    rating,
    reviewText:
      typeof item.text === "string" && item.text.trim() ? item.text.trim() : null,
    reviewerName:
      typeof item.name === "string" && item.name.trim() ? item.name.trim() : null,
    reviewerUrl:
      typeof item.reviewerUrl === "string" && item.reviewerUrl.trim()
        ? item.reviewerUrl.trim()
        : null,
    ownerResponseText: ownerText,
    ownerResponseDate: parseOwnerResponseDate(item),
    rawResponse: item,
  };
}

export async function upsertReviews(
  db: Client,
  items: ApifyReviewItem[],
  businessId: string,
  googlePlaceId: string | null,
): Promise<ReviewImportStats> {
  const unique = flattenApifyReviewItems(items);
  const stats: ReviewImportStats = {
    datasetRows: items.length,
    uniqueReviews: unique.length,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    failures: [],
  };

  for (const item of unique) {
    const mapped = mapApifyItemToReview(item, businessId, googlePlaceId);
    if (!mapped) {
      stats.skipped += 1;
      continue;
    }

    try {
      const result = await db.query(
        `
        insert into public.reviews (
          business_id,
          provider,
          provider_review_id,
          google_place_id,
          published_at,
          rating,
          review_text,
          reviewer_name,
          reviewer_url,
          owner_response_text,
          owner_response_date,
          raw_response,
          imported_at,
          updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, now(), now()
        )
        on conflict (provider, provider_review_id) do update set
          business_id = excluded.business_id,
          google_place_id = coalesce(excluded.google_place_id, reviews.google_place_id),
          published_at = excluded.published_at,
          rating = excluded.rating,
          review_text = excluded.review_text,
          reviewer_name = coalesce(excluded.reviewer_name, reviews.reviewer_name),
          reviewer_url = coalesce(excluded.reviewer_url, reviews.reviewer_url),
          owner_response_text = excluded.owner_response_text,
          owner_response_date = excluded.owner_response_date,
          raw_response = excluded.raw_response,
          imported_at = now(),
          updated_at = now()
        returning (xmax = 0) as inserted
        `,
        [
          mapped.businessId,
          REVIEW_PROVIDER,
          mapped.providerReviewId,
          mapped.googlePlaceId,
          mapped.publishedAt.toISOString(),
          mapped.rating,
          mapped.reviewText,
          mapped.reviewerName,
          mapped.reviewerUrl,
          mapped.ownerResponseText,
          mapped.ownerResponseDate
            ? mapped.ownerResponseDate.toISOString()
            : null,
          JSON.stringify(mapped.rawResponse),
        ],
      );

      const inserted = Boolean(result.rows[0]?.inserted);
      if (inserted) stats.created += 1;
      else stats.updated += 1;
    } catch (err) {
      stats.failed += 1;
      stats.failures.push({
        reviewId: mapped.providerReviewId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return stats;
}
