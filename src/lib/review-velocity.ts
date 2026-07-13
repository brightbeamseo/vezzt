export type SnapshotPoint = {
  snapshotDate: string; // YYYY-MM-DD
  reviewCount: number | null;
};

export type ReviewVelocityMetrics = {
  reviewsSincePrevious: number | null;
  reviewsGainedApprox30d: number | null;
  reviewsGainedApprox90d: number | null;
  avgWeeklyReviewVelocity: number | null;
  estimatedMonthlyReviewVelocity: number | null;
  reviewAcceleration: number | null;
  snapshotCount: number;
  insufficientHistory: boolean;
};

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000);
}

function countAtOrBefore(
  snapshots: SnapshotPoint[],
  target: Date,
): number | null {
  let best: SnapshotPoint | null = null;
  for (const s of snapshots) {
    if (s.reviewCount === null) continue;
    const d = parseDate(s.snapshotDate);
    if (d.getTime() <= target.getTime()) {
      if (!best || parseDate(best.snapshotDate) < d) best = s;
    }
  }
  return best?.reviewCount ?? null;
}

/**
 * Compute review velocity from ordered snapshots (oldest → newest).
 * Returns null metrics when fewer than 2 count snapshots exist.
 */
export function calculateReviewVelocity(
  snapshots: SnapshotPoint[],
): ReviewVelocityMetrics {
  const usable = snapshots
    .filter((s) => s.reviewCount !== null)
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

  if (usable.length < 2) {
    return {
      reviewsSincePrevious: null,
      reviewsGainedApprox30d: null,
      reviewsGainedApprox90d: null,
      avgWeeklyReviewVelocity: null,
      estimatedMonthlyReviewVelocity: null,
      reviewAcceleration: null,
      snapshotCount: usable.length,
      insufficientHistory: true,
    };
  }

  const newest = usable[usable.length - 1];
  const previous = usable[usable.length - 2];
  const oldest = usable[0];
  const newestCount = newest.reviewCount as number;
  const previousCount = previous.reviewCount as number;
  const oldestCount = oldest.reviewCount as number;

  const reviewsSincePrevious = newestCount - previousCount;

  const newestDate = parseDate(newest.snapshotDate);
  const target30 = new Date(newestDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const target90 = new Date(newestDate.getTime() - 90 * 24 * 60 * 60 * 1000);

  const count30 = countAtOrBefore(usable, target30);
  const count90 = countAtOrBefore(usable, target90);

  // Prefer true lookback when we have an older-enough snapshot; else null
  const spanDays = daysBetween(parseDate(oldest.snapshotDate), newestDate);
  const reviewsGainedApprox30d =
    count30 !== null
      ? newestCount - count30
      : spanDays >= 25
        ? newestCount - oldestCount
        : null;
  const reviewsGainedApprox90d =
    count90 !== null
      ? newestCount - count90
      : spanDays >= 80
        ? newestCount - oldestCount
        : null;

  const avgWeeklyReviewVelocity =
    spanDays > 0 ? ((newestCount - oldestCount) / spanDays) * 7 : null;
  const estimatedMonthlyReviewVelocity =
    avgWeeklyReviewVelocity !== null ? avgWeeklyReviewVelocity * (30 / 7) : null;

  let reviewAcceleration: number | null = null;
  if (usable.length >= 3) {
    const mid = usable[Math.floor(usable.length / 2)];
    const midCount = mid.reviewCount as number;
    const firstHalfDays = daysBetween(
      parseDate(oldest.snapshotDate),
      parseDate(mid.snapshotDate),
    );
    const secondHalfDays = daysBetween(
      parseDate(mid.snapshotDate),
      newestDate,
    );
    if (firstHalfDays > 0 && secondHalfDays > 0) {
      const v1 = ((midCount - oldestCount) / firstHalfDays) * 7;
      const v2 = ((newestCount - midCount) / secondHalfDays) * 7;
      reviewAcceleration = v2 - v1;
    }
  }

  return {
    reviewsSincePrevious,
    reviewsGainedApprox30d,
    reviewsGainedApprox90d,
    avgWeeklyReviewVelocity,
    estimatedMonthlyReviewVelocity,
    reviewAcceleration,
    snapshotCount: usable.length,
    insufficientHistory: false,
  };
}
