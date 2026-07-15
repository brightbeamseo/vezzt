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
    medianOrganicTraffic: median(rows.map((r) => r.organicTraffic.value)),
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
    case "organicTraffic":
      return row.organicTraffic.value;
    case "organicKeywords":
      return row.organicKeywords.value;
    case "keywordsTop3":
      return row.keywordsTop3.value;
    case "referringDomains":
      return row.referringDomains.value;
    case "backlinks":
      return row.backlinks.value;
    case "trafficValue":
      return row.trafficValue.value;
    case "domainRating":
      return row.domainRating.value;
    case "parentOrganicTraffic":
      return row.parentOrganicTraffic?.value ?? null;
    case "parentOrganicKeywords":
      return row.parentOrganicKeywords?.value ?? null;
    case "parentReferringDomains":
      return row.parentReferringDomains?.value ?? null;
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
    case "zipPopulation":
      return row.zipPopulation;
    case "zipHouseholds":
      return row.zipHouseholds;
    case "zipOwnerOccupiedHousingUnits":
      return row.zipOwnerOccupiedHousingUnits;
    case "zipOwnerOccupiedRate":
      return row.zipOwnerOccupiedRate;
    case "zipMedianHouseholdIncome":
      return row.zipMedianHouseholdIncome;
    case "zipMedianHomeValue":
      return row.zipMedianHomeValue;
    default:
      return null;
  }
}
