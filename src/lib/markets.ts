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
      "Eagle",
      "Star",
      "Kuna",
      "Nampa",
      "Caldwell",
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
      /** Reserved — coordinate check not active for this pilot. */
      matchedBy?: never;
    };

/**
 * Validate that a business belongs to the market.
 * Pilot: city allowlist only. Coordinates reserved for later.
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

  // Future: if (market.boundingBox && lat/lng inside) return ok matchedBy coords

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
