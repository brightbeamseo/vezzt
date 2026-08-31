/**
 * Local Opportunity Area geometry + selection helpers.
 * 15-mile analytical radius; ZCTA-centroid membership.
 */

export const LOA_RADIUS_MILES = 15;
/** Minimum spacing between selected opportunity centers. */
export const LOA_MIN_SPACING_MILES = 12;
/** Nearby places appended to display name (companions). */
export const LOA_COMPANION_MILES = 11;
export const LOA_COMPANION_MIN_POP = 20_000;
/** Absolute minimum place population to be a candidate (sparse states use lower). */
export const LOA_MIN_PLACE_POP_DEFAULT = 8_000;
export const LOA_MIN_PLACE_POP_SPARSE = 4_000;
export const LOA_SPARSE_STATES = new Set(["Wyoming", "Montana", "Nevada"]);

export const STATE_FIPS: Record<string, string> = {
  Idaho: "16",
  Oregon: "41",
  Washington: "53",
  Utah: "49",
  Wyoming: "56",
  Nevada: "32",
  Montana: "30",
};

export const FIPS_TO_STATE: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS).map(([k, v]) => [v, k]),
);

/** Haversine distance in miles. */
export function distanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function cleanPlaceName(name: string): string {
  return name
    .replace(/ city$/i, "")
    .replace(/ CDP$/i, "")
    .replace(/ town$/i, "")
    .replace(/ village$/i, "")
    .replace(/ borough$/i, "")
    .replace(/ municipality$/i, "")
    .replace(/,/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Max distance from macro market center to consider a place part of that market. */
export function marketCatchmentMiles(marketPopulation: number | null): number {
  const pop = marketPopulation ?? 50_000;
  return Math.min(70, Math.max(28, 22 + pop / 40_000));
}

export type PlaceCandidate = {
  geoid: string;
  name: string;
  displayCity: string;
  state: string;
  stateFips: string;
  lat: number;
  lng: number;
  population: number;
  landSqMi: number;
};

export type SelectedCenter = {
  place: PlaceCandidate;
  macroMarketId: string;
  macroMarketSlug: string;
  macroMarketName: string;
  companions: PlaceCandidate[];
  displayName: string;
  slug: string;
  selectionRank: number;
  suppressedNear?: string[];
};

export function minPlacePopulation(state: string): number {
  return LOA_SPARSE_STATES.has(state)
    ? LOA_MIN_PLACE_POP_SPARSE
    : LOA_MIN_PLACE_POP_DEFAULT;
}

/**
 * Greedy population-ranked selection with min spacing.
 * Large cross-state neighbors can survive at ≥8 miles (e.g. Portland / Vancouver).
 */
export function selectCentersForMarket(input: {
  macroMarketId: string;
  macroMarketSlug: string;
  macroMarketName: string;
  marketCenter: { lat: number; lng: number };
  marketPopulation: number | null;
  marketStates: string[];
  candidates: PlaceCandidate[];
  startRank: number;
}): { selected: SelectedCenter[]; suppressed: Array<{ place: PlaceCandidate; reason: string }> } {
  const catchment = marketCatchmentMiles(input.marketPopulation);
  const inCatchment = input.candidates
    .filter((p) => input.marketStates.includes(p.state))
    .filter(
      (p) =>
        distanceMiles({ lat: p.lat, lng: p.lng }, input.marketCenter) <=
        catchment,
    )
    .filter((p) => p.population >= minPlacePopulation(p.state))
    .sort((a, b) => b.population - a.population || a.name.localeCompare(b.name));

  const selected: SelectedCenter[] = [];
  const suppressed: Array<{ place: PlaceCandidate; reason: string }> = [];
  const used = new Set<string>();

  for (const place of inCatchment) {
    if (used.has(place.geoid)) continue;

    const conflicts = selected.filter((s) => {
      const d = distanceMiles(
        { lat: place.lat, lng: place.lng },
        { lat: s.place.lat, lng: s.place.lng },
      );
      if (d >= LOA_MIN_SPACING_MILES) return false;
      // Cross-state pair both ≥50k and ≥8 miles: allow both.
      if (
        place.state !== s.place.state &&
        place.population >= 50_000 &&
        s.place.population >= 50_000 &&
        d >= 8
      ) {
        return false;
      }
      // Two large places (≥40k) at ≥10 miles: allow both (submarket retention).
      if (
        place.population >= 40_000 &&
        s.place.population >= 40_000 &&
        d >= 10
      ) {
        return false;
      }
      return true;
    });

    if (conflicts.length > 0) {
      suppressed.push({
        place,
        reason: `Within ${LOA_MIN_SPACING_MILES}mi of ${conflicts.map((c) => c.place.displayCity).join(", ")}`,
      });
      used.add(place.geoid);
      continue;
    }

    used.add(place.geoid);
    selected.push({
      place,
      macroMarketId: input.macroMarketId,
      macroMarketSlug: input.macroMarketSlug,
      macroMarketName: input.macroMarketName,
      companions: [],
      displayName: place.displayCity,
      slug: "",
      selectionRank: input.startRank + selected.length,
    });
  }

  // Attach companions for naming (nearby suppressed / remaining places).
  const pool = inCatchment;
  for (const sel of selected) {
    const companions = pool
      .filter((p) => p.geoid !== sel.place.geoid)
      .filter((p) => !selected.some((s) => s.place.geoid === p.geoid))
      .filter(
        (p) =>
          distanceMiles(
            { lat: p.lat, lng: p.lng },
            { lat: sel.place.lat, lng: sel.place.lng },
          ) <= LOA_COMPANION_MILES,
      )
      .filter((p) => p.population >= LOA_COMPANION_MIN_POP)
      .sort((a, b) => b.population - a.population)
      .slice(0, 3);

    sel.companions = companions;
    const parts = [sel.place.displayCity, ...companions.map((c) => c.displayCity)];
    sel.displayName = parts.join(" / ");
    sel.slug = slugifyLoa(sel.displayName, sel.place.state, input.macroMarketSlug);
  }

  // Ensure at least one center: market center itself if nothing selected.
  if (selected.length === 0) {
    const fallback: PlaceCandidate = {
      geoid: `market:${input.macroMarketSlug}`,
      name: input.macroMarketName,
      displayCity: input.macroMarketName.replace(/ Metro$/i, ""),
      state: input.marketStates[0] ?? "Unknown",
      stateFips: STATE_FIPS[input.marketStates[0] ?? ""] ?? "",
      lat: input.marketCenter.lat,
      lng: input.marketCenter.lng,
      population: input.marketPopulation ?? 0,
      landSqMi: 0,
    };
    selected.push({
      place: fallback,
      macroMarketId: input.macroMarketId,
      macroMarketSlug: input.macroMarketSlug,
      macroMarketName: input.macroMarketName,
      companions: [],
      displayName: fallback.displayCity,
      slug: slugifyLoa(fallback.displayCity, fallback.state, input.macroMarketSlug),
      selectionRank: input.startRank,
    });
  }

  return { selected, suppressed };
}

export function slugifyLoa(
  displayName: string,
  state: string,
  marketSlug: string,
): string {
  const base = `${displayName}-${state}-${marketSlug}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base;
}

export type ZctaPoint = {
  zipCode: string;
  lat: number;
  lng: number;
};

export function zctasWithinRadius(
  center: { lat: number; lng: number },
  zctas: ZctaPoint[],
  radiusMiles: number = LOA_RADIUS_MILES,
): Array<ZctaPoint & { distanceMiles: number }> {
  return zctas
    .map((z) => ({
      ...z,
      distanceMiles: distanceMiles(center, { lat: z.lat, lng: z.lng }),
    }))
    .filter((z) => z.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

export type ZctaDemo = {
  zipCode: string;
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupiedUnits: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  medianYearStructureBuilt: number | null;
  singleFamilyDetachedUnits: number | null;
};

export type AggregatedLoaDemographics = {
  population: number | null;
  households: number | null;
  housingUnits: number | null;
  ownerOccupiedUnits: number | null;
  ownerOccupiedRate: number | null;
  ownerOccupiedPer1kResidents: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  medianYearStructureBuilt: number | null;
  singleFamilyDetachedUnits: number | null;
  singleFamilyShare: number | null;
  populationGrowth: number | null;
  householdGrowth: number | null;
  housingGrowth: number | null;
  zctaCount: number;
  zctaCodes: string[];
  aggregationMethod: string;
};

function sum(nums: Array<number | null>): number | null {
  const vals = nums.filter((n): n is number => n !== null && Number.isFinite(n));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0);
}

/** Household-weighted average of medians (approximation — not a true median). */
function weightedMedianApprox(
  rows: Array<{ weight: number | null; value: number | null }>,
): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.weight === null || r.value === null || r.weight <= 0) continue;
    num += r.weight * r.value;
    den += r.weight;
  }
  if (den <= 0) return null;
  return num / den;
}

function pctChange(current: number | null, baseline: number | null): number | null {
  if (
    current === null ||
    baseline === null ||
    baseline <= 0 ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline)
  ) {
    return null;
  }
  return ((current - baseline) / baseline) * 100;
}

export function aggregateZctaDemographics(input: {
  current: ZctaDemo[];
  baseline: ZctaDemo[];
}): AggregatedLoaDemographics {
  const current = input.current;
  const baselineByZip = new Map(input.baseline.map((b) => [b.zipCode, b]));

  const population = sum(current.map((c) => c.population));
  const households = sum(current.map((c) => c.households));
  const housingUnits = sum(current.map((c) => c.housingUnits));
  const ownerOccupiedUnits = sum(current.map((c) => c.ownerOccupiedUnits));
  const singleFamilyDetachedUnits = sum(
    current.map((c) => c.singleFamilyDetachedUnits),
  );

  const baselinePop = sum(
    current.map((c) => baselineByZip.get(c.zipCode)?.population ?? null),
  );
  const baselineHh = sum(
    current.map((c) => baselineByZip.get(c.zipCode)?.households ?? null),
  );
  const baselineHu = sum(
    current.map((c) => baselineByZip.get(c.zipCode)?.housingUnits ?? null),
  );

  return {
    population,
    households,
    housingUnits,
    ownerOccupiedUnits,
    ownerOccupiedRate:
      ownerOccupiedUnits !== null && households !== null && households > 0
        ? (ownerOccupiedUnits / households) * 100
        : null,
    ownerOccupiedPer1kResidents:
      ownerOccupiedUnits !== null && population !== null && population > 0
        ? (ownerOccupiedUnits / population) * 1000
        : null,
    medianHouseholdIncome: weightedMedianApprox(
      current.map((c) => ({
        weight: c.households,
        value: c.medianHouseholdIncome,
      })),
    ),
    medianHomeValue: weightedMedianApprox(
      current.map((c) => ({
        weight: c.ownerOccupiedUnits ?? c.housingUnits,
        value: c.medianHomeValue,
      })),
    ),
    medianYearStructureBuilt: weightedMedianApprox(
      current.map((c) => ({
        weight: c.housingUnits,
        value: c.medianYearStructureBuilt,
      })),
    ),
    singleFamilyDetachedUnits,
    singleFamilyShare:
      singleFamilyDetachedUnits !== null &&
      housingUnits !== null &&
      housingUnits > 0
        ? singleFamilyDetachedUnits / housingUnits
        : null,
    populationGrowth: pctChange(population, baselinePop),
    householdGrowth: pctChange(households, baselineHh),
    housingGrowth: pctChange(housingUnits, baselineHu),
    zctaCount: current.length,
    zctaCodes: current.map((c) => c.zipCode).sort(),
    aggregationMethod:
      "ZCTA centroids within 15mi; counts summed; medians household-/unit-weighted averages (approx)",
  };
}
