/**
 * US Census ACS helpers for ZIP Code Tabulation Areas (ZCTA).
 * Server-side only — never expose CENSUS_API_KEY to the client.
 */

export const CENSUS_ACS_BASE = "https://api.census.gov/data/2024/acs/acs5";
export const CENSUS_DATASET_YEAR = 2024;
export const CENSUS_DATASET_NAME = "ACS 5-Year Detailed Tables";
export const CENSUS_DATA_SOURCE = "US Census ACS";

export const CENSUS_ACS_VARIABLES = [
  "NAME",
  "B01003_001E", // total population
  "B11001_001E", // total households
  "B25001_001E", // total housing units
  "B25003_002E", // owner-occupied occupied housing units
  "B19013_001E", // median household income
  "B25077_001E", // median home value
  "B25035_001E", // median year structure built
] as const;

export type CensusZipStats = {
  zipCode: string;
  name: string | null;
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupiedHousingUnits: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  medianYearStructureBuilt: number | null;
  ownerOccupiedRate: number | null;
  rawResponse: unknown;
};

/** Normalize to 5-digit ZIP / ZCTA, or null if unusable. */
export function normalizeZipCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/\D/g, "");
  if (digits.length < 5) return null;
  return digits.slice(0, 5);
}

/**
 * Census ACS missing / suppression sentinels and invalid negatives → unavailable.
 * See https://www.census.gov/data/developers/data-sets/acs-5year.html
 */
export function parseCensusNumber(
  value: string | number | null | undefined,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  // Common ACS missing/suppressed codes are large negatives.
  if (n < 0) return null;
  return n;
}

export function computeOwnerOccupiedRate(
  ownerOccupied: number | null,
  households: number | null,
): number | null {
  if (ownerOccupied === null || households === null || households <= 0) {
    return null;
  }
  return (ownerOccupied / households) * 100;
}

export function buildCensusZctaUrl(
  zipCodes: string[],
  apiKey?: string | null,
): string {
  const unique = [...new Set(zipCodes.map((z) => normalizeZipCode(z)).filter(Boolean))] as string[];
  if (unique.length === 0) {
    throw new Error("No ZIP codes provided for Census request");
  }
  const params = new URLSearchParams();
  params.set("get", CENSUS_ACS_VARIABLES.join(","));
  params.set("for", `zip code tabulation area:${unique.join(",")}`);
  if (apiKey) params.set("key", apiKey);
  return `${CENSUS_ACS_BASE}?${params.toString()}`;
}

type CensusTable = string[][];

function rowsToObjects(table: CensusTable): Record<string, string>[] {
  if (!Array.isArray(table) || table.length < 2) return [];
  const headers = table[0]!;
  return table.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

export function mapCensusRow(row: Record<string, string>): CensusZipStats | null {
  const zip =
    normalizeZipCode(row["zip code tabulation area"]) ??
    normalizeZipCode(row.ZCTA5) ??
    null;
  if (!zip) return null;

  const population = parseCensusNumber(row.B01003_001E);
  const households = parseCensusNumber(row.B11001_001E);
  const housingUnits = parseCensusNumber(row.B25001_001E);
  const ownerOccupiedHousingUnits = parseCensusNumber(row.B25003_002E);
  const medianHouseholdIncome = parseCensusNumber(row.B19013_001E);
  const medianHomeValue = parseCensusNumber(row.B25077_001E);
  const medianYearStructureBuilt = parseCensusNumber(row.B25035_001E);

  return {
    zipCode: zip,
    name: row.NAME?.trim() || null,
    population,
    households,
    housingUnits,
    ownerOccupiedHousingUnits,
    medianHouseholdIncome,
    medianHomeValue,
    medianYearStructureBuilt,
    ownerOccupiedRate: computeOwnerOccupiedRate(
      ownerOccupiedHousingUnits,
      households,
    ),
    rawResponse: row,
  };
}

export async function fetchCensusZctaStats(input: {
  zipCodes: string[];
  apiKey?: string | null;
  /** Max ZCTAs per HTTP request (Census multi-geo queries). */
  batchSize?: number;
}): Promise<{
  matched: CensusZipStats[];
  unavailable: string[];
  errors: Array<{ zipCodes: string[]; error: string }>;
}> {
  const apiKey = input.apiKey?.trim() || null;
  if (!apiKey) {
    throw new Error(
      "CENSUS_API_KEY is required. The Census Data API now requires a free API key for all queries. Sign up at https://api.census.gov/data/key_signup.html and add CENSUS_API_KEY to .env.local (server-side only).",
    );
  }

  const batchSize = input.batchSize ?? 40;
  const wanted = [
    ...new Set(
      input.zipCodes
        .map((z) => normalizeZipCode(z))
        .filter((z): z is string => Boolean(z)),
    ),
  ].sort();

  const matched: CensusZipStats[] = [];
  const errors: Array<{ zipCodes: string[]; error: string }> = [];
  const found = new Set<string>();

  for (let i = 0; i < wanted.length; i += batchSize) {
    const batch = wanted.slice(i, i + batchSize);
    const url = buildCensusZctaUrl(batch, apiKey);
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "follow",
      });
      const contentType = res.headers.get("content-type") ?? "";
      const bodyText = await res.text();

      if (
        bodyText.includes("Missing Key") ||
        bodyText.includes("missing_key") ||
        !contentType.includes("json")
      ) {
        errors.push({
          zipCodes: batch,
          error: `Census API rejected request (likely missing/invalid key). HTTP ${res.status}. Body: ${bodyText.slice(0, 200)}`,
        });
        continue;
      }

      if (!res.ok) {
        errors.push({
          zipCodes: batch,
          error: `HTTP ${res.status}: ${bodyText.slice(0, 300)}`,
        });
        continue;
      }

      const json = JSON.parse(bodyText) as CensusTable;
      const objects = rowsToObjects(json);
      for (const row of objects) {
        const mapped = mapCensusRow(row);
        if (!mapped) continue;
        matched.push(mapped);
        found.add(mapped.zipCode);
      }
    } catch (err) {
      errors.push({
        zipCodes: batch,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const unavailable = wanted.filter((z) => !found.has(z));
  return { matched, unavailable, errors };
}
