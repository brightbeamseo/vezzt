export const DEFAULT_REVIEW_THRESHOLD = 50;

export type QualificationStatus =
  | "qualified"
  | "below_threshold"
  | "excluded"
  | "manual_review";

export type QualificationInput = {
  name: string;
  primaryCategory: string | null;
  secondaryCategories: string[] | null;
  websiteUrl: string | null;
  reviewCount: number | null;
};

export type QualificationResult = {
  isQualified: boolean;
  reviewThresholdMet: boolean;
  qualificationStatus: QualificationStatus;
  qualificationReason: string;
  qualificationConfidence: number;
  targetSector: string | null;
  borderline: boolean;
};

const ROOFING_CATEGORY_TERMS = [
  "roofing contractor",
  "roofer",
  "roof repair",
  "roofing supply",
  "roofing service",
  "roofing company",
  "roof installation",
  "roof replacement",
  "commercial roofing",
  "residential roofing",
];

const ROOFING_NAME_HINTS = [
  "roofing",
  "roofer",
  "roofers",
  "roof repair",
  "metal roof",
  "shingle",
];

const EXCLUDE_CATEGORY_TERMS = [
  "pressure washing",
  "pressure washer",
  "handyman",
  "handywoman",
  "handyperson",
  "painter",
  "painting",
  "house painter",
  "siding contractor",
  "siding service",
  "window cleaning",
  "gutter cleaning",
  "general contractor",
  "restoration service",
  "water damage restoration",
  "fire damage restoration",
  "insulation contractor",
  "insulation company",
  "insulation service",
];

const EXCLUDE_NAME_HINTS = [
  "pressure wash",
  "handyman",
  "painter",
  "painting",
  "siding only",
];

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function includesAny(haystack: string, needles: string[]): string | null {
  for (const needle of needles) {
    if (haystack.includes(needle)) {
      return needle;
    }
  }
  return null;
}

function allCategories(input: QualificationInput): string[] {
  const list = [
    input.primaryCategory,
    ...(input.secondaryCategories ?? []),
  ].filter(Boolean) as string[];
  return list.map((c) => normalize(c));
}

function hasRoofingCategory(categories: string[]): string | null {
  for (const category of categories) {
    const hit = includesAny(category, ROOFING_CATEGORY_TERMS);
    if (hit) return `${category} (~${hit})`;
    if (/\broofing\b/.test(category) || /\broofer\b/.test(category)) {
      return category;
    }
  }
  return null;
}

function hasExcludeCategory(categories: string[]): string | null {
  for (const category of categories) {
    const hit = includesAny(category, EXCLUDE_CATEGORY_TERMS);
    if (hit) return `${category} (~${hit})`;
  }
  return null;
}

function nameWebsiteRoofingSignal(input: QualificationInput): {
  strong: boolean;
  reasons: string[];
} {
  const name = normalize(input.name);
  const website = normalize(input.websiteUrl);
  const reasons: string[] = [];

  const nameHit = includesAny(name, ROOFING_NAME_HINTS);
  if (nameHit) reasons.push(`name contains "${nameHit}"`);

  const websiteHit =
    includesAny(website, ["roofing", "roofer", "roof-repair", "roofrepair"]) ??
    null;
  if (websiteHit) reasons.push(`website contains "${websiteHit}"`);

  // Strong = name clearly roofing, optionally backed by website
  const strong =
    Boolean(nameHit) &&
    (Boolean(websiteHit) || /\broofing\b/.test(name) || /\broofers?\b/.test(name));

  return { strong, reasons };
}

/**
 * Qualify a business for the roofing MVP vertical.
 * Does not delete or mutate DB — returns status for persistence.
 */
export function qualifyRoofingBusiness(
  input: QualificationInput,
  reviewThreshold: number = DEFAULT_REVIEW_THRESHOLD,
): QualificationResult {
  const categories = allCategories(input);
  const name = normalize(input.name);
  const roofingCategoryHit = hasRoofingCategory(categories);
  const excludeCategoryHit = hasExcludeCategory(categories);
  const nameWebsite = nameWebsiteRoofingSignal(input);
  const reviewCount = input.reviewCount ?? 0;
  const reviewThresholdMet = reviewCount >= reviewThreshold;

  // Hard excludes when category is unrelated and there is no roofing category/name signal
  if (excludeCategoryHit && !roofingCategoryHit) {
    const isSidingOnly =
      /siding/.test(excludeCategoryHit) &&
      !/\broof/.test(name) &&
      !nameWebsite.reasons.length;
    const isGeneralContractor =
      excludeCategoryHit.includes("general contractor") &&
      !roofingCategoryHit &&
      !nameWebsite.strong;
    const isRestoration =
      excludeCategoryHit.includes("restoration") && !nameWebsite.strong;
    const isInsulationOnly =
      /insulation/.test(excludeCategoryHit) &&
      !roofingCategoryHit &&
      !nameWebsite.strong;
    const isPressureOrHandymanOrPaint =
      /pressure wash|handyman|handywoman|handyperson|paint/.test(
        excludeCategoryHit,
      );

    if (
      isPressureOrHandymanOrPaint ||
      isSidingOnly ||
      isGeneralContractor ||
      isRestoration ||
      isInsulationOnly
    ) {
      // Borderline: name strongly says roofing despite exclude category
      if (nameWebsite.strong) {
        return finalize({
          reviewThresholdMet,
          reviewCount,
          reviewThreshold,
          status: "manual_review",
          reason: `Borderline: excluded-looking category (${excludeCategoryHit}) but roofing name/website signals (${nameWebsite.reasons.join("; ")})`,
          confidence: 0.55,
          sector: "roofing",
          borderline: true,
        });
      }

      return finalize({
        reviewThresholdMet,
        reviewCount,
        reviewThreshold,
        status: "excluded",
        reason: `Excluded unrelated category: ${excludeCategoryHit}`,
        confidence: 0.9,
        sector: null,
        borderline: false,
      });
    }
  }

  // Clear roofing category match (including dual roofing + siding)
  if (roofingCategoryHit) {
    const alsoSiding = categories.some((c) => /siding/.test(c));
    const reason = alsoSiding
      ? `Roofing category match (${roofingCategoryHit}); also lists siding — kept as roofing`
      : `Roofing category match (${roofingCategoryHit})`;

    return finalize({
      reviewThresholdMet,
      reviewCount,
      reviewThreshold,
      status: reviewThresholdMet ? "qualified" : "below_threshold",
      reason,
      confidence: 0.92,
      sector: "roofing",
      borderline: false,
    });
  }

  // Siding-only with no roofing signal
  if (
    categories.some((c) => /siding/.test(c)) &&
    !nameWebsite.strong &&
    !includesAny(name, ROOFING_NAME_HINTS)
  ) {
    return finalize({
      reviewThresholdMet,
      reviewCount,
      reviewThreshold,
      status: "excluded",
      reason: `Excluded siding-only (primary: ${input.primaryCategory ?? "none"})`,
      confidence: 0.88,
      sector: null,
      borderline: false,
    });
  }

  // Strong name + website roofing, no roofing category
  if (nameWebsite.strong) {
    return finalize({
      reviewThresholdMet,
      reviewCount,
      reviewThreshold,
      status: "manual_review",
      reason: `No roofing category, but strong name/website signals (${nameWebsite.reasons.join("; ")})`,
      confidence: 0.65,
      sector: "roofing",
      borderline: true,
    });
  }

  // Weak name-only roofing hint
  if (nameWebsite.reasons.some((r) => r.startsWith("name contains"))) {
    return finalize({
      reviewThresholdMet,
      reviewCount,
      reviewThreshold,
      status: "manual_review",
      reason: `Weak roofing name signal only (${nameWebsite.reasons.join("; ")}) — needs review`,
      confidence: 0.45,
      sector: "roofing",
      borderline: true,
    });
  }

  return finalize({
    reviewThresholdMet,
    reviewCount,
    reviewThreshold,
    status: "excluded",
    reason: `No roofing category, name, or website signal (primary: ${input.primaryCategory ?? "none"})`,
    confidence: 0.85,
    sector: null,
    borderline: false,
  });
}

function finalize(args: {
  reviewThresholdMet: boolean;
  reviewCount: number;
  reviewThreshold: number;
  status: QualificationStatus;
  reason: string;
  confidence: number;
  sector: string | null;
  borderline: boolean;
}): QualificationResult {
  let status = args.status;
  let reason = args.reason;

  if (
    (status === "qualified" || status === "below_threshold") &&
    !args.reviewThresholdMet
  ) {
    status = "below_threshold";
    reason = `${reason}. Reviews ${args.reviewCount} < threshold ${args.reviewThreshold}`;
  } else if (status === "qualified" && args.reviewThresholdMet) {
    reason = `${reason}. Reviews ${args.reviewCount} >= threshold ${args.reviewThreshold}`;
  }

  const isQualified = status === "qualified";

  return {
    isQualified,
    reviewThresholdMet: args.reviewThresholdMet,
    qualificationStatus: status,
    qualificationReason: reason,
    qualificationConfidence: args.confidence,
    targetSector: args.sector,
    borderline: args.borderline || status === "manual_review",
  };
}
