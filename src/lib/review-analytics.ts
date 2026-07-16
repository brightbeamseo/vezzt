/**
 * Raw review-history analytics (no proprietary Review Velocity Score).
 */

export type ReviewRecord = {
  publishedAt: Date;
  rating: number | null;
  ownerResponseText: string | null;
  ownerResponseDate: Date | null;
};

export type ReviewAnalytics = {
  totalImportedReviews: number;
  earliestReviewDate: string | null;
  latestReviewDate: string | null;
  reviewsLast30Days: number;
  reviewsLast90Days: number;
  reviewsLast365Days: number;
  /** Average reviews per month over last 90 days (reviewsLast90Days / 3). */
  avgReviewsPerMonth90d: number | null;
  /** Average reviews per month over last 365 days (reviewsLast365Days / 12). */
  avgReviewsPerMonth365d: number | null;
  /** Current 90-day review velocity = reviews in last 90 days / 3 (monthly rate). */
  current90DayMonthlyVelocity: number | null;
  /** Prior 90-day window (days 91–180) / 3. */
  prior90DayMonthlyVelocity: number | null;
  /**
   * Review momentum %:
   * ((current90 - prior90) / prior90) * 100 when prior90 > 0.
   */
  reviewMomentumPct: number | null;
  averageRatingLast90Days: number | null;
  averageRatingLast365Days: number | null;
  ownerResponseRate: number | null;
  /** Median hours from review publish to owner response when both dates exist. */
  medianOwnerResponseHours: number | null;
};

export type ReviewMonthlyStat = {
  businessId: string;
  month: string; // YYYY-MM-01
  reviewsReceived: number;
  averageRating: number | null;
  cumulativeReviewCount: number;
  responsesCount: number;
  responseRate: number | null;
};

function startOfDayUtc(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

function daysAgo(from: Date, days: number): Date {
  const d = startOfDayUtc(from);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function calculateReviewAnalytics(
  reviews: ReviewRecord[],
  now: Date = new Date(),
): ReviewAnalytics {
  if (reviews.length === 0) {
    return {
      totalImportedReviews: 0,
      earliestReviewDate: null,
      latestReviewDate: null,
      reviewsLast30Days: 0,
      reviewsLast90Days: 0,
      reviewsLast365Days: 0,
      avgReviewsPerMonth90d: null,
      avgReviewsPerMonth365d: null,
      current90DayMonthlyVelocity: null,
      prior90DayMonthlyVelocity: null,
      reviewMomentumPct: null,
      averageRatingLast90Days: null,
      averageRatingLast365Days: null,
      ownerResponseRate: null,
      medianOwnerResponseHours: null,
    };
  }

  const sorted = [...reviews].sort(
    (a, b) => a.publishedAt.getTime() - b.publishedAt.getTime(),
  );
  const earliest = sorted[0]!.publishedAt;
  const latest = sorted[sorted.length - 1]!.publishedAt;

  const cutoff30 = daysAgo(now, 30);
  const cutoff90 = daysAgo(now, 90);
  const cutoff180 = daysAgo(now, 180);
  const cutoff365 = daysAgo(now, 365);

  const inLast30 = sorted.filter((r) => r.publishedAt >= cutoff30);
  const inLast90 = sorted.filter((r) => r.publishedAt >= cutoff90);
  const inPrior90 = sorted.filter(
    (r) => r.publishedAt >= cutoff180 && r.publishedAt < cutoff90,
  );
  const inLast365 = sorted.filter((r) => r.publishedAt >= cutoff365);

  const current90 = inLast90.length;
  const prior90 = inPrior90.length;
  const currentVel = current90 / 3;
  const priorVel = prior90 / 3;

  let momentum: number | null = null;
  if (prior90 > 0) {
    momentum = ((current90 - prior90) / prior90) * 100;
  } else if (current90 > 0) {
    momentum = null; // no prior baseline
  }

  const responded = sorted.filter(
    (r) =>
      typeof r.ownerResponseText === "string" &&
      r.ownerResponseText.trim().length > 0,
  );
  const ownerResponseRate =
    sorted.length > 0 ? responded.length / sorted.length : null;

  const responseHours: number[] = [];
  for (const r of sorted) {
    if (!r.ownerResponseDate) continue;
    if (
      !(
        typeof r.ownerResponseText === "string" &&
        r.ownerResponseText.trim().length > 0
      )
    ) {
      continue;
    }
    const hours =
      (r.ownerResponseDate.getTime() - r.publishedAt.getTime()) /
      (1000 * 60 * 60);
    if (Number.isFinite(hours) && hours >= 0) {
      responseHours.push(hours);
    }
  }

  return {
    totalImportedReviews: sorted.length,
    earliestReviewDate: toIsoDate(earliest),
    latestReviewDate: toIsoDate(latest),
    reviewsLast30Days: inLast30.length,
    reviewsLast90Days: current90,
    reviewsLast365Days: inLast365.length,
    avgReviewsPerMonth90d: current90 / 3,
    avgReviewsPerMonth365d: inLast365.length / 12,
    current90DayMonthlyVelocity: currentVel,
    prior90DayMonthlyVelocity: priorVel,
    reviewMomentumPct: momentum,
    averageRatingLast90Days: avg(
      inLast90
        .map((r) => r.rating)
        .filter((n): n is number => typeof n === "number"),
    ),
    averageRatingLast365Days: avg(
      inLast365
        .map((r) => r.rating)
        .filter((n): n is number => typeof n === "number"),
    ),
    ownerResponseRate,
    medianOwnerResponseHours: median(responseHours),
  };
}

/**
 * Rolling 90-day reviews-per-month velocity at each month end.
 * velocity = (reviews in trailing 90 days ending at month end) / 3
 */
export function calculateRolling90DayVelocity(
  reviews: ReviewRecord[],
  months: string[], // YYYY-MM-01
): { month: string; velocity: number }[] {
  return months.map((month) => {
    const year = Number(month.slice(0, 4));
    const monthIndex = Number(month.slice(5, 7)) - 1; // 0-based
    const monthEnd = new Date(
      Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999),
    );
    const start = new Date(monthEnd);
    start.setUTCDate(start.getUTCDate() - 89);
    start.setUTCHours(0, 0, 0, 0);

    const count = reviews.filter(
      (r) => r.publishedAt >= start && r.publishedAt <= monthEnd,
    ).length;
    return { month, velocity: count / 3 };
  });
}

export function buildMonthlyStatsFromReviews(
  businessId: string,
  reviews: ReviewRecord[],
): ReviewMonthlyStat[] {
  if (reviews.length === 0) return [];

  const byMonth = new Map<
    string,
    { ratings: number[]; responses: number; count: number }
  >();

  for (const r of reviews) {
    const key = `${r.publishedAt.getUTCFullYear()}-${String(r.publishedAt.getUTCMonth() + 1).padStart(2, "0")}-01`;
    let bucket = byMonth.get(key);
    if (!bucket) {
      bucket = { ratings: [], responses: 0, count: 0 };
      byMonth.set(key, bucket);
    }
    bucket.count += 1;
    if (typeof r.rating === "number") bucket.ratings.push(r.rating);
    if (
      typeof r.ownerResponseText === "string" &&
      r.ownerResponseText.trim().length > 0
    ) {
      bucket.responses += 1;
    }
  }

  const months = Array.from(byMonth.keys()).sort();
  let cumulative = 0;
  return months.map((month) => {
    const b = byMonth.get(month)!;
    cumulative += b.count;
    return {
      businessId,
      month,
      reviewsReceived: b.count,
      averageRating: avg(b.ratings),
      cumulativeReviewCount: cumulative,
      responsesCount: b.responses,
      responseRate: b.count > 0 ? b.responses / b.count : null,
    };
  });
}
