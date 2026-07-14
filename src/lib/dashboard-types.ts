import type { QualificationStatus } from "@/lib/qualification";

export type ReviewSnapshotSummary = {
  id: string;
  snapshotDate: string;
  reviewCount: number | null;
  averageRating: number | null;
  source: string;
};

export type DashboardBusiness = {
  id: string;
  name: string;
  primaryCategory: string | null;
  secondaryCategories: string[] | null;
  websiteUrl: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsUrl: string | null;
  isActive: boolean;
  isQualified: boolean;
  qualificationStatus: QualificationStatus;
  qualificationReason: string | null;
  qualificationConfidence: number | null;
  targetSector: string | null;
  reviewThresholdMet: boolean;
  // Latest snapshot
  reviewCount: number | null;
  averageRating: number | null;
  latestSnapshotDate: string | null;
  // From business_metrics (nullable — do not invent)
  vestimateLow: number | null;
  vestimateMid: number | null;
  vestimateHigh: number | null;
  confidenceScore: number | null;
  acquisitionScore: number | null;
  reviewVelocityMonthly: number | null;
  estimatedAnnualRevenue: number | null;
  // proprietary_scores table does not exist yet — always null placeholders
  growthScore: number | null;
  marketStrength: number | null;
  brandStrength: number | null;
  modelVersion: string | null;
  hasCoordinates: boolean;
};

export type DashboardBusinessDetail = DashboardBusiness & {
  snapshots: ReviewSnapshotSummary[];
  enrichment: {
    employeeCountEstimate: number | null;
    foundedYear: number | null;
    yearsInBusiness: number | null;
    linkedinUrl: string | null;
    facebookUrl: string | null;
    instagramUrl: string | null;
    entityName: string | null;
    entityStatus: string | null;
    ownerNames: string[] | null;
    adsDetected: boolean | null;
    seoTrafficEstimate: number | null;
    notes: string | null;
  } | null;
  metricsUpdatedAt: string | null;
  mapRank: {
    id: string;
    providerScanId: string;
    searchTerm: string;
    scannedAt: string | null;
    gridSize: number | null;
    spacingValue: number | null;
    spacingUnit: string | null;
    averageGridRank: number | null;
    averageTotalGridRank: number | null;
    shareOfLocalVoice: number | null;
    foundInTop3Count: number | null;
    foundInTop10Count: number | null;
    totalGridPoints: number | null;
    ranks: unknown;
    status: string | null;
    errorMessage: string | null;
  } | null;
  seo: {
    id: string;
    provider: string;
    domain: string;
    snapshotDate: string;
    domainRating: number | null;
    referringDomains: number | null;
    backlinks: number | null;
    organicTraffic: number | null;
    organicKeywords: number | null;
    organicKeywordsTop3: number | null;
    trafficValue: number | null;
  } | null;
};

export type DashboardSummary = {
  totalBusinesses: number;
  withReviewData: number;
  averageReviewCount: number | null;
  averageRating: number | null;
  highestReviewCount: number | null;
  qualifiedCount: number;
  belowThresholdCount: number;
  missingCoordinatesCount: number;
};

/** Placeholder until proprietary_scores / scoring engine ships. */
export const SCORE_MODEL_STATUS =
  "Not calculated — proprietary_scores table does not exist yet";
