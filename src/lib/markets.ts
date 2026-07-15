/**
 * Market definitions for Vezzt collection.
 * Every scrape/import job must target exactly one market.
 *
 * Discovery uses map-centered Google Maps search URLs (Apify startUrls),
 * not city-name locationQuery — that mode missed listings like Idaho Roofing Contractors.
 */

export type MarketId = "boise-metro";

export type MarketCityCenter = {
  city: string;
  /** Map search center latitude. */
  lat: number;
  /** Map search center longitude. */
  lng: number;
  /** Google Maps zoom for discovery search URLs (default 13). */
  zoom?: number;
};

export type MarketDefinition = {
  id: MarketId;
  name: string;
  state: string;
  /** IANA timezone for local-hours scan scheduling. */
  timezone: string;
  /** Approved city names (case-insensitive match). */
  cities: string[];
  /** Map centers used for Apify startUrls discovery (required per city). */
  cityCenters: MarketCityCenter[];
  /** Default discovery search terms for this market's vertical pilots. */
  roofingSearchTerms: string[];
  /**
   * Optional bounding box for future coordinate validation.
   * [minLng, minLat, maxLng, maxLat] — not enforced yet.
   */
  boundingBox?: [number, number, number, number];
};

/** Primary monthly discovery keyword (map-centered, not locationQuery). */
export const PRIMARY_ROOFING_SEARCH_TERM = "roofing contractor";

/** Monthly discovery depth: results per city Maps URL. */
export const MONTHLY_DISCOVERY_MAX_PER_CITY = 100;

/** Default Maps zoom for city-centered discovery URLs. */
export const DEFAULT_MAP_ZOOM = 13;

export const MARKETS: Record<MarketId, MarketDefinition> = {
  "boise-metro": {
    id: "boise-metro",
    name: "Boise Metro",
    state: "Idaho",
    timezone: "America/Boise",
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
    // Approximate downtown / local-pack centers (verified Meridian matches browser).
    cityCenters: [
      { city: "Boise", lat: 43.615, lng: -116.2023, zoom: 13 },
      { city: "Meridian", lat: 43.5814383, lng: -116.4187121, zoom: 13 },
      { city: "Nampa", lat: 43.5407, lng: -116.5635, zoom: 13 },
      { city: "Caldwell", lat: 43.6629, lng: -116.6874, zoom: 13 },
      { city: "Eagle", lat: 43.6954, lng: -116.354, zoom: 13 },
      { city: "Kuna", lat: 43.491, lng: -116.4201, zoom: 13 },
      { city: "Star", lat: 43.6921, lng: -116.4935, zoom: 13 },
      { city: "Garden City", lat: 43.6218, lng: -116.246, zoom: 13 },
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

export function getCityCenter(
  market: MarketDefinition,
  city: string,
): MarketCityCenter {
  const normalized = normalizeCityName(city);
  const center = market.cityCenters.find(
    (c) => normalizeCityName(c.city) === normalized,
  );
  if (!center) {
    throw new Error(
      `No map center for city "${city}" in market ${market.id}. Add it to cityCenters.`,
    );
  }
  return center;
}

/** Build a Google Maps local-search URL (browser-equivalent discovery). */
export function mapsSearchUrl(
  searchTerm: string,
  center: Pick<MarketCityCenter, "lat" | "lng" | "zoom">,
): string {
  const zoom = center.zoom ?? DEFAULT_MAP_ZOOM;
  const q = encodeURIComponent(searchTerm.trim());
  return `https://www.google.com/maps/search/${q}/@${center.lat},${center.lng},${zoom}z`;
}

/** Legacy helper — prefer mapsSearchUrl / marketDiscoveryJobs for scrapes. */
export function marketLocationQueries(market: MarketDefinition): string[] {
  return market.cities.map((city) => `${city}, ${market.state}, USA`);
}

export type MarketDiscoveryJob = {
  city: string;
  searchTerm: string;
  /** Google Maps search URL used as Apify startUrls entry. */
  mapsUrl: string;
  /** Human-readable city label for logs / city-stamp fallbacks. */
  locationLabel: string;
};

/**
 * City × search-term discovery matrix using map-centered Maps URLs.
 * Default terms: primary monthly keyword only (not the full synonym list).
 */
export function marketDiscoveryJobs(
  market: MarketDefinition,
  searchTerms: string[] = [PRIMARY_ROOFING_SEARCH_TERM],
): MarketDiscoveryJob[] {
  const jobs: MarketDiscoveryJob[] = [];
  for (const city of market.cities) {
    const center = getCityCenter(market, city);
    for (const searchTerm of searchTerms) {
      jobs.push({
        city,
        searchTerm,
        mapsUrl: mapsSearchUrl(searchTerm, center),
        locationLabel: `${city}, ${market.state}, USA`,
      });
    }
  }
  return jobs;
}

/** Monthly schedule input: one Maps URL per city for the primary term. */
export function monthlyDiscoveryStartUrls(
  market: MarketDefinition,
  searchTerm: string = PRIMARY_ROOFING_SEARCH_TERM,
): { url: string }[] {
  return market.cities.map((city) => ({
    url: mapsSearchUrl(searchTerm, getCityCenter(market, city)),
  }));
}
