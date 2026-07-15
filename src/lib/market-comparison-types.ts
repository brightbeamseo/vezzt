import type { CompanyScale, OwnershipModel } from "@/lib/companies";
import type { QualificationStatus } from "@/lib/qualification";
import type { SearchScope } from "@/lib/search-scope";

export type MarketComparisonFilters = {
  marketId: string;
  sector: string;
  city: string | "all";
  minReviews: number;
  companyScale: CompanyScale | "all";
  ownershipModel: OwnershipModel | "all";
  qualificationStatus: QualificationStatus | "all";
  searchScope: SearchScope | "all";
  hasAhrefs: boolean;
  hasGeogrid: boolean;
  hasMultipleReviewSnapshots: boolean;
  missingDataOnly: boolean;
};

export const DEFAULT_MARKET_COMPARISON_FILTERS: MarketComparisonFilters = {
  marketId: "boise-metro",
  sector: "roofing",
  city: "all",
  minReviews: 100,
  companyScale: "all",
  ownershipModel: "all",
  qualificationStatus: "qualified",
  searchScope: "all",
  hasAhrefs: false,
  hasGeogrid: false,
  hasMultipleReviewSnapshots: false,
  missingDataOnly: false,
};

export type MarketComparisonColumnId =
  | "businessName"
  | "city"
  | "companyName"
  | "companyScale"
  | "ownershipModel"
  | "website"
  | "searchScope"
  | "analysisTarget"
  | "analysisMode"
  | "reviewCount"
  | "rating"
  | "reviewSnapshotDate"
  | "reviewsGainedSincePrior"
  | "weeklyReviewVelocity"
  | "estimatedMonthlyReviewVelocity"
  | "organicTraffic"
  | "organicKeywords"
  | "keywordsTop3"
  | "referringDomains"
  | "backlinks"
  | "trafficValue"
  | "domainRating"
  | "parentOrganicTraffic"
  | "parentOrganicKeywords"
  | "parentReferringDomains"
  | "shareOfLocalVoice"
  | "averageGridRank"
  | "averageTotalGridRank"
  | "top3Coverage"
  | "top10Coverage"
  | "geogridScanDate"
  | "dataCompleteness"
  | "missingFields"
  | "latestDataRefresh"
  | "manualReviewFlag"
  | "zipPopulation"
  | "zipHouseholds"
  | "zipOwnerOccupiedHousingUnits"
  | "zipOwnerOccupiedRate"
  | "zipMedianHouseholdIncome"
  | "zipMedianHomeValue"
  | "businessStrength"
  | "growthScore"
  | "marketStrength"
  | "vestimate"
  | "confidenceScore";

export type MarketComparisonColumnDef = {
  id: MarketComparisonColumnId;
  label: string;
  group: string;
  numeric: boolean;
  defaultVisible: boolean;
  percentileOf?:
    | "reviewCount"
    | "organicTraffic"
    | "shareOfLocalVoice"
    | "referringDomains";
};

export const MARKET_COMPARISON_COLUMNS: MarketComparisonColumnDef[] = [
  { id: "businessName", label: "Business", group: "Identity", numeric: false, defaultVisible: true },
  { id: "city", label: "City", group: "Identity", numeric: false, defaultVisible: true },
  { id: "companyName", label: "Company", group: "Identity", numeric: false, defaultVisible: false },
  { id: "companyScale", label: "Company scale", group: "Identity", numeric: false, defaultVisible: true },
  { id: "ownershipModel", label: "Ownership model", group: "Identity", numeric: false, defaultVisible: true },
  { id: "website", label: "Website", group: "Identity", numeric: false, defaultVisible: false },
  { id: "searchScope", label: "Search Scope", group: "Ahrefs", numeric: false, defaultVisible: true },
  { id: "analysisTarget", label: "Analysis Target", group: "Ahrefs", numeric: false, defaultVisible: true },
  { id: "analysisMode", label: "Analysis mode", group: "Ahrefs", numeric: false, defaultVisible: false },
  {
    id: "reviewCount",
    label: "Reviews",
    group: "Google",
    numeric: true,
    defaultVisible: true,
    percentileOf: "reviewCount",
  },
  { id: "rating", label: "Rating", group: "Google", numeric: true, defaultVisible: true },
  { id: "reviewSnapshotDate", label: "Review snapshot", group: "Google", numeric: false, defaultVisible: false },
  {
    id: "reviewsGainedSincePrior",
    label: "Reviews gained",
    group: "Google",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "weeklyReviewVelocity",
    label: "Review velocity",
    group: "Google",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "estimatedMonthlyReviewVelocity",
    label: "Est. monthly velocity",
    group: "Google",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "organicTraffic",
    label: "Organic Traffic",
    group: "Ahrefs",
    numeric: true,
    defaultVisible: true,
    percentileOf: "organicTraffic",
  },
  {
    id: "organicKeywords",
    label: "Organic Keywords",
    group: "Ahrefs",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "keywordsTop3",
    label: "Keywords 1–3",
    group: "Ahrefs",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "domainRating",
    label: "Domain Rating",
    group: "Ahrefs",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "referringDomains",
    label: "Referring Domains",
    group: "Ahrefs",
    numeric: true,
    defaultVisible: true,
    percentileOf: "referringDomains",
  },
  {
    id: "backlinks",
    label: "Backlinks",
    group: "Ahrefs",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "trafficValue",
    label: "Traffic value",
    group: "Ahrefs",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "parentOrganicTraffic",
    label: "Parent/Company organic traffic",
    group: "Ahrefs parent",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "parentOrganicKeywords",
    label: "Parent/Company organic keywords",
    group: "Ahrefs parent",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "parentReferringDomains",
    label: "Parent/Company referring domains",
    group: "Ahrefs parent",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "shareOfLocalVoice",
    label: "SoLV",
    group: "GeoGrid",
    numeric: true,
    defaultVisible: true,
    percentileOf: "shareOfLocalVoice",
  },
  {
    id: "averageGridRank",
    label: "Avg Rank",
    group: "GeoGrid",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "averageTotalGridRank",
    label: "ATGR",
    group: "GeoGrid",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "top3Coverage",
    label: "Top 3",
    group: "GeoGrid",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "top10Coverage",
    label: "Top 10",
    group: "GeoGrid",
    numeric: true,
    defaultVisible: false,
  },
  {
    id: "geogridScanDate",
    label: "GeoGrid scan date",
    group: "GeoGrid",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "dataCompleteness",
    label: "Data Completeness",
    group: "Quality",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "zipPopulation",
    label: "ZIP Population",
    group: "Census ZIP",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "zipHouseholds",
    label: "Households",
    group: "Census ZIP",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "zipOwnerOccupiedHousingUnits",
    label: "Owner-Occupied Housing Units",
    group: "Census ZIP",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "zipOwnerOccupiedRate",
    label: "Owner-Occupied Rate",
    group: "Census ZIP",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "zipMedianHouseholdIncome",
    label: "Median Household Income",
    group: "Census ZIP",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "zipMedianHomeValue",
    label: "Median Home Value",
    group: "Census ZIP",
    numeric: true,
    defaultVisible: true,
  },
  {
    id: "missingFields",
    label: "Missing fields",
    group: "Quality",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "latestDataRefresh",
    label: "Latest refresh",
    group: "Quality",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "manualReviewFlag",
    label: "Manual review",
    group: "Quality",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "businessStrength",
    label: "Business Strength",
    group: "Future",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "growthScore",
    label: "Growth Score",
    group: "Future",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "marketStrength",
    label: "Market Strength",
    group: "Future",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "vestimate",
    label: "Vestimate",
    group: "Future",
    numeric: false,
    defaultVisible: false,
  },
  {
    id: "confidenceScore",
    label: "Confidence Score",
    group: "Future",
    numeric: false,
    defaultVisible: false,
  },
];

export const DEFAULT_VISIBLE_COLUMNS: MarketComparisonColumnId[] =
  MARKET_COMPARISON_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);

export const FUTURE_METRIC_LABEL = "Not calculated";

export type ScopedMetric = {
  value: number | null;
  searchScope: SearchScope;
};

export type MarketComparisonRow = {
  businessId: string;
  businessName: string;
  city: string | null;
  state: string | null;
  websiteUrl: string | null;
  googleMapsUrl: string | null;
  primaryCategory: string | null;
  targetSector: string | null;
  marketId: string | null;
  /** markets.id UUID when available */
  marketUuid?: string | null;
  marketName?: string | null;
  qualificationStatus: string;
  isQualified: boolean;
  /** Preferred Ahrefs analysis target shown in primary columns. */
  analysisTarget: string | null;
  analysisMode: string | null;
  /** Overall preferred search scope for the primary traffic/keywords target. */
  searchScope: SearchScope;
  companyId: string | null;
  companyName: string | null;
  companyScale: string | null;
  ownershipModel: string | null;
  companyLocationCount: number | null;
  companyRootDomain: string | null;
  classificationIsManual: boolean;
  reviewCount: number | null;
  rating: number | null;
  reviewSnapshotDate: string | null;
  reviewsGainedSincePrior: number | null;
  weeklyReviewVelocity: number | null;
  estimatedMonthlyReviewVelocity: number | null;
  reviewSnapshotCount: number;
  organicTraffic: ScopedMetric;
  organicKeywords: ScopedMetric;
  keywordsTop3: ScopedMetric;
  referringDomains: ScopedMetric;
  backlinks: ScopedMetric;
  trafficValue: ScopedMetric;
  domainRating: ScopedMetric;
  /** True when primary traffic is Mixed with no Location snapshot. */
  mixedWithoutLocationWarning: boolean;
  hasLocationSeo: boolean;
  parentOrganicTraffic: ScopedMetric | null;
  parentOrganicKeywords: ScopedMetric | null;
  parentReferringDomains: ScopedMetric | null;
  parentSearchScope: SearchScope | null;
  parentAnalysisTarget: string | null;
  parentDomain: string | null;
  shareOfLocalVoice: number | null;
  averageGridRank: number | null;
  averageTotalGridRank: number | null;
  top3Coverage: number | null;
  top10Coverage: number | null;
  foundInTop3Count: number | null;
  foundInTop10Count: number | null;
  totalGridPoints: number | null;
  geogridScanDate: string | null;
  providerScanId: string | null;
  dataCompleteness: number;
  missingFields: string[];
  latestDataRefresh: string | null;
  postalCode: string | null;
  zipCodeNormalized: string | null;
  zipPopulation: number | null;
  zipHouseholds: number | null;
  zipHousingUnits: number | null;
  zipOwnerOccupiedHousingUnits: number | null;
  zipOwnerOccupiedRate: number | null;
  zipMedianHouseholdIncome: number | null;
  zipMedianHomeValue: number | null;
  zipMedianYearStructureBuilt: number | null;
  zipDatasetYear: number | null;
  hasAhrefs: boolean;
  hasGeogrid: boolean;
  hasMultipleReviewSnapshots: boolean;
  percentiles: {
    reviewCount: number | null;
    organicTraffic: number | null;
    shareOfLocalVoice: number | null;
    referringDomains: number | null;
  };
  ahrefsUrl: string | null;
  geogridUrl: string | null;
};

export type MarketComparisonSummary = {
  businessCount: number;
  withAhrefs: number;
  withGeogrid: number;
  withMultipleReviewSnapshots: number;
  medianReviews: number | null;
  medianOrganicTraffic: number | null;
  medianSolv: number | null;
  averageDataCompleteness: number | null;
};

export type MarketComparisonPayload = {
  marketId: string;
  sector: string;
  rows: MarketComparisonRow[];
  cities: string[];
  duplicateBusinessIds: string[];
  /** Shared market Census overview — shown once above the table, not per row. */
  marketOverview: {
    id: string;
    marketName: string;
    marketSlug: string;
    marketType: string | null;
    cbsaCode: string | null;
    timezone: string | null;
    population: number | null;
    households: number | null;
    housingUnits: number | null;
    ownerOccupiedUnits: number | null;
    ownerOccupiedRate: number | null;
    medianHouseholdIncome: number | null;
    medianHomeValue: number | null;
    medianYearStructureBuilt: number | null;
    datasetYear: number | null;
    dataSource: string | null;
    lastUpdated: string | null;
    businessesInMarket: number;
    qualifiedBusinesses: number;
  } | null;
};
