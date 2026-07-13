/**
 * Market definitions for Vezzt collection.
 * Every scrape/import job must target exactly one market.
 */

export type MarketId = "boise-metro";

export type MarketDefinition = {
  id: MarketId;
  name: string;
  state: string;
  /** Approved city names (case-insensitive match). */
  cities: string[];
  /** Default discovery search terms for this market's vertical pilots. */
  roofingSearchTerms: string[];
  /**
   * Optional bounding box for future coordinate validation.
   * [minLng, minLat, maxLng, maxLat] — not enforced yet.
   */
  boundingBox?: [number, number, number, number];
};

export const MARKETS: Record<MarketId, MarketDefinition> = {
  "boise-metro": {
    id: "boise-metro",
    name: "Boise Metro",
    state: "Idaho",
    cities: [
      "Boise",
      "Meridian",
      "Nampa",
      "Caldwell",
      "Eagle",
      "Kuna",
      "Star",
      "Garden City",
    ],
    roofingSearchTerms: [
      "roofing contractor",
      "roofing company",
      "roof repair",
      "residential roofing",
      "commercial roofing",
      "metal roofing",
      "flat roofing",
    ],
    // Rough Treasure Valley box — reserved for future coordinate checks
    boundingBox: [-116.95, 43.35, -115.95, 43.85],
  },
};

export function getMarket(marketId: string): MarketDefinition {
  const market = MARKETS[marketId as MarketId];
  if (!market) {
    throw new Error(
      `Unknown market "${marketId}". Known: ${Object.keys(MARKETS).join(", ")}`,
    );
  }
  return market;
}

export function normalizeCityName(city: string | null | undefined): string {
  return (city ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export type MarketMembershipResult =
  | { ok: true; matchedBy: "city"; city: string }
  | {
      ok: false;
      reason: string;
      city: string | null;
    };

/**
 * Validate that a business belongs to the market.
 * Current: city allowlist only. Coordinates reserved for later.
 */
export function isInMarket(
  market: MarketDefinition,
  input: {
    city?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  },
): MarketMembershipResult {
  const city = input.city?.trim() || null;
  const normalized = normalizeCityName(city);
  const allowed = new Set(market.cities.map(normalizeCityName));

  if (city && allowed.has(normalized)) {
    const canonical =
      market.cities.find((c) => normalizeCityName(c) === normalized) ?? city;
    return { ok: true, matchedBy: "city", city: canonical };
  }

  if (!city) {
    return {
      ok: false,
      reason: `City missing; not in ${market.name} allowlist (${market.cities.join(", ")})`,
      city: null,
    };
  }

  return {
    ok: false,
    reason: `City "${city}" is outside ${market.name} (allowed: ${market.cities.join(", ")})`,
    city,
  };
}

/** Apify locationQuery strings — one city per collection job within the market. */
export function marketLocationQueries(market: MarketDefinition): string[] {
  return market.cities.map((city) => `${city}, ${market.state}, USA`);
}

/** Full city × search-term discovery matrix for a market. */
export function marketDiscoveryJobs(
  market: MarketDefinition,
  searchTerms: string[] = market.roofingSearchTerms,
): { city: string; locationQuery: string; searchTerm: string }[] {
  const jobs: { city: string; locationQuery: string; searchTerm: string }[] =
    [];
  for (const city of market.cities) {
    for (const searchTerm of searchTerms) {
      jobs.push({
        city,
        locationQuery: `${city}, ${market.state}, USA`,
        searchTerm,
      });
    }
  }
  return jobs;
}
