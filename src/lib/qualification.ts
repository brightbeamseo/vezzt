export const DEFAULT_REVIEW_THRESHOLD = 50;

/** Exact primary Google category required for the initial roofing dataset. */
export const ROOFING_PRIMARY_CATEGORY = "Roofing contractor";

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

function normalizeCategory(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Qualify for the roofing dataset using primary Google category only.
 * Must be exactly "Roofing contractor" (case-insensitive, whitespace-normalized).
 * Does not use business name keyword matching.
 */
export function qualifyRoofingBusiness(
  input: QualificationInput,
  reviewThreshold: number = DEFAULT_REVIEW_THRESHOLD,
): QualificationResult {
  const primary = normalizeCategory(input.primaryCategory);
  const expected = normalizeCategory(ROOFING_PRIMARY_CATEGORY);
  const reviewCount = input.reviewCount ?? 0;
  const reviewThresholdMet = reviewCount >= reviewThreshold;

  if (primary === expected) {
    const status: QualificationStatus = reviewThresholdMet
      ? "qualified"
      : "below_threshold";
    const reason =
      status === "qualified"
        ? `Primary category is "${ROOFING_PRIMARY_CATEGORY}". Reviews ${reviewCount} >= threshold ${reviewThreshold}`
        : `Primary category is "${ROOFING_PRIMARY_CATEGORY}". Reviews ${reviewCount} < threshold ${reviewThreshold}`;

    return {
      isQualified: status === "qualified",
      reviewThresholdMet,
      qualificationStatus: status,
      qualificationReason: reason,
      qualificationConfidence: 0.98,
      targetSector: "roofing",
      borderline: false,
    };
  }

  const shown = input.primaryCategory?.trim() || "none";
  return {
    isQualified: false,
    reviewThresholdMet,
    qualificationStatus: "excluded",
    qualificationReason: `Primary category "${shown}" is not "${ROOFING_PRIMARY_CATEGORY}" (name matching disabled)`,
    qualificationConfidence: 0.95,
    targetSector: null,
    borderline: false,
  };
}
