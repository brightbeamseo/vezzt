import type { MarketComparisonRow, MarketComparisonSummary } from "@/lib/market-comparison-types";

export function median(values: Array<number | null>): number | null {
  const nums = values
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) {
    return (nums[mid - 1]! + nums[mid]!) / 2;
  }
  return nums[mid]!;
}

/** Average percentile rank (0–100) of `value` within `universe`. */
export function percentileRank(
  value: number | null,
  universe: Array<number | null>,
): number | null {
  if (value === null) return null;
  const nums = universe.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const below = nums.filter((v) => v < value).length;
  const equal = nums.filter((v) => v === value).length;
  return Math.round(((below + 0.5 * equal) / nums.length) * 100);
}

export function summarizeMarketComparisonRows(
  rows: MarketComparisonRow[],
): MarketComparisonSummary {
  return {
    businessCount: rows.length,
    withAhrefs: rows.filter((r) => r.hasAhrefs).length,
    withGeogrid: rows.filter((r) => r.hasGeogrid).length,
    withMultipleReviewSnapshots: rows.filter(
      (r) => r.hasMultipleReviewSnapshots,
    ).length,
    medianReviews: median(rows.map((r) => r.reviewCount)),
    medianOrganicTraffic: median(rows.map((r) => r.localOrganicTraffic)),
    medianSolv: median(rows.map((r) => r.shareOfLocalVoice)),
    averageDataCompleteness:
      rows.length === 0
        ? null
        : Math.round(
            rows.reduce((sum, r) => sum + r.dataCompleteness, 0) / rows.length,
          ),
  };
}

export function getNumericSortValue(
  row: MarketComparisonRow,
  columnId: string,
): number | null {
  switch (columnId) {
    case "reviewCount":
      return row.reviewCount;
    case "rating":
      return row.rating;
    case "reviewsGainedSincePrior":
      return row.reviewsGainedSincePrior;
    case "weeklyReviewVelocity":
      return row.weeklyReviewVelocity;
    case "estimatedMonthlyReviewVelocity":
      return row.estimatedMonthlyReviewVelocity;
    case "localOrganicTraffic":
      return row.localOrganicTraffic;
    case "localOrganicKeywords":
      return row.localOrganicKeywords;
    case "localKeywordsTop3":
      return row.localKeywordsTop3;
    case "localReferringDomains":
      return row.localReferringDomains;
    case "localBacklinks":
      return row.localBacklinks;
    case "localTrafficValue":
      return row.localTrafficValue;
    case "parentDomainRating":
      return row.parentDomainRating;
    case "parentOrganicTraffic":
      return row.parentOrganicTraffic;
    case "parentOrganicKeywords":
      return row.parentOrganicKeywords;
    case "parentReferringDomains":
      return row.parentReferringDomains;
    case "shareOfLocalVoice":
      return row.shareOfLocalVoice;
    case "averageGridRank":
      return row.averageGridRank;
    case "averageTotalGridRank":
      return row.averageTotalGridRank;
    case "top3Coverage":
      return row.top3Coverage;
    case "top10Coverage":
      return row.top10Coverage;
    case "dataCompleteness":
      return row.dataCompleteness;
    default:
      return null;
  }
}
