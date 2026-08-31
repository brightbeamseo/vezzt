/**
 * Candidate markets for Market Opportunity / Expansion Analysis (Phase 1).
 *
 * Maintainable config — not a scoring model.
 * Markets map to Census CBSA / micro areas where possible for ACS demographics.
 * Localities + centers prepare Phase 2 Maps discovery (not run here).
 *
 * Existing Boise collection ops stay in src/lib/markets.ts.
 */

export type OpportunityLocality = {
  city: string;
  state: string;
  lat: number;
  lng: number;
  zoom?: number;
};

export type OpportunityMarketDefinition = {
  slug: string;
  name: string;
  /** Display / primary state name(s). */
  states: string[];
  /** IANA timezone for future local-hours scheduling. */
  timezone: string;
  marketType: "metro" | "msa" | "custom";
  /** Official CBSA code when known (preferred over name resolution). */
  cbsaCode?: string;
  /** Fallback name needles for Census CBSA resolution. */
  cbsaNameIncludes?: string[];
  /** Primary market center for future discovery. */
  center: { lat: number; lng: number };
  localities: OpportunityLocality[];
};

/**
 * ~55 commercially meaningful Western markets (ID/OR/WA/UT/NV/MT/WY).
 * Prefer metro/micro CBSA groupings over every incorporated town.
 */
export const OPPORTUNITY_MARKETS: OpportunityMarketDefinition[] = [
  // --- Idaho ---
  {
    slug: "boise-metro",
    name: "Boise Metro",
    states: ["Idaho"],
    timezone: "America/Boise",
    marketType: "metro",
    cbsaCode: "14260",
    cbsaNameIncludes: ["boise city", "id"],
    center: { lat: 43.615, lng: -116.2023 },
    localities: [
      { city: "Boise", state: "Idaho", lat: 43.615, lng: -116.2023 },
      { city: "Meridian", state: "Idaho", lat: 43.5814383, lng: -116.4187121 },
      { city: "Nampa", state: "Idaho", lat: 43.5407, lng: -116.5635 },
      { city: "Caldwell", state: "Idaho", lat: 43.6629, lng: -116.6874 },
      { city: "Eagle", state: "Idaho", lat: 43.6954, lng: -116.354 },
      { city: "Kuna", state: "Idaho", lat: 43.491, lng: -116.4201 },
      { city: "Star", state: "Idaho", lat: 43.6921, lng: -116.4935 },
      { city: "Garden City", state: "Idaho", lat: 43.6218, lng: -116.246 },
    ],
  },
  {
    slug: "idaho-falls",
    name: "Idaho Falls",
    states: ["Idaho"],
    timezone: "America/Boise",
    marketType: "metro",
    cbsaCode: "26820",
    cbsaNameIncludes: ["idaho falls", "id"],
    center: { lat: 43.4917, lng: -112.0339 },
    localities: [
      { city: "Idaho Falls", state: "Idaho", lat: 43.4917, lng: -112.0339 },
      { city: "Ammon", state: "Idaho", lat: 43.4696, lng: -111.9666 },
      { city: "Rexburg", state: "Idaho", lat: 43.826, lng: -111.7897 },
    ],
  },
  {
    slug: "pocatello",
    name: "Pocatello",
    states: ["Idaho"],
    timezone: "America/Boise",
    marketType: "metro",
    cbsaCode: "38540",
    cbsaNameIncludes: ["pocatello", "id"],
    center: { lat: 42.8713, lng: -112.4455 },
    localities: [
      { city: "Pocatello", state: "Idaho", lat: 42.8713, lng: -112.4455 },
      { city: "Chubbuck", state: "Idaho", lat: 42.9207, lng: -112.4661 },
    ],
  },
  {
    slug: "twin-falls",
    name: "Twin Falls",
    states: ["Idaho"],
    timezone: "America/Boise",
    marketType: "metro",
    cbsaCode: "46300",
    cbsaNameIncludes: ["twin falls", "id"],
    center: { lat: 42.5629, lng: -114.4609 },
    localities: [
      { city: "Twin Falls", state: "Idaho", lat: 42.5629, lng: -114.4609 },
      { city: "Jerome", state: "Idaho", lat: 42.7241, lng: -114.5186 },
    ],
  },
  {
    slug: "coeur-dalene",
    name: "Coeur d'Alene",
    states: ["Idaho"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "17660",
    cbsaNameIncludes: ["coeur d'alene", "id"],
    center: { lat: 47.6777, lng: -116.7805 },
    localities: [
      { city: "Coeur d'Alene", state: "Idaho", lat: 47.6777, lng: -116.7805 },
      { city: "Post Falls", state: "Idaho", lat: 47.7124, lng: -116.9516 },
      { city: "Hayden", state: "Idaho", lat: 47.766, lng: -116.7866 },
    ],
  },
  {
    slug: "lewiston",
    name: "Lewiston",
    states: ["Idaho", "Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "30300",
    cbsaNameIncludes: ["lewiston", "id"],
    center: { lat: 46.4165, lng: -117.0177 },
    localities: [
      { city: "Lewiston", state: "Idaho", lat: 46.4165, lng: -117.0177 },
      { city: "Clarkston", state: "Washington", lat: 46.4168, lng: -117.044 },
    ],
  },
  {
    slug: "moscow-pullman",
    name: "Moscow / Pullman",
    states: ["Idaho", "Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "39420",
    cbsaNameIncludes: ["pullman", "wa"],
    center: { lat: 46.7324, lng: -117.0002 },
    localities: [
      { city: "Moscow", state: "Idaho", lat: 46.7324, lng: -117.0002 },
      { city: "Pullman", state: "Washington", lat: 46.7298, lng: -117.1817 },
    ],
  },

  // --- Oregon ---
  {
    slug: "portland-vancouver",
    name: "Portland / Vancouver",
    states: ["Oregon", "Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "38900",
    cbsaNameIncludes: ["portland", "vancouver", "hillsboro"],
    center: { lat: 45.5152, lng: -122.6784 },
    localities: [
      { city: "Portland", state: "Oregon", lat: 45.5152, lng: -122.6784 },
      { city: "Vancouver", state: "Washington", lat: 45.6387, lng: -122.6615 },
      { city: "Beaverton", state: "Oregon", lat: 45.4871, lng: -122.8037 },
      { city: "Hillsboro", state: "Oregon", lat: 45.5229, lng: -122.9898 },
      { city: "Gresham", state: "Oregon", lat: 45.5001, lng: -122.4302 },
      { city: "Tigard", state: "Oregon", lat: 45.4312, lng: -122.7715 },
    ],
  },
  {
    slug: "salem-or",
    name: "Salem",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "41420",
    cbsaNameIncludes: ["salem", "or"],
    center: { lat: 44.9429, lng: -123.0351 },
    localities: [
      { city: "Salem", state: "Oregon", lat: 44.9429, lng: -123.0351 },
      { city: "Keizer", state: "Oregon", lat: 44.9901, lng: -123.0262 },
    ],
  },
  {
    slug: "eugene-springfield",
    name: "Eugene / Springfield",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "21660",
    cbsaNameIncludes: ["eugene", "springfield", "or"],
    center: { lat: 44.0521, lng: -123.0868 },
    localities: [
      { city: "Eugene", state: "Oregon", lat: 44.0521, lng: -123.0868 },
      { city: "Springfield", state: "Oregon", lat: 44.0462, lng: -123.022 },
    ],
  },
  {
    slug: "bend-or",
    name: "Bend",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "13460",
    cbsaNameIncludes: ["bend", "or"],
    center: { lat: 44.0582, lng: -121.3153 },
    localities: [
      { city: "Bend", state: "Oregon", lat: 44.0582, lng: -121.3153 },
      { city: "Redmond", state: "Oregon", lat: 44.2726, lng: -121.1739 },
    ],
  },
  {
    slug: "medford-or",
    name: "Medford",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "32780",
    cbsaNameIncludes: ["medford", "or"],
    center: { lat: 42.3265, lng: -122.8756 },
    localities: [
      { city: "Medford", state: "Oregon", lat: 42.3265, lng: -122.8756 },
      { city: "Ashland", state: "Oregon", lat: 42.1946, lng: -122.7095 },
    ],
  },
  {
    slug: "grants-pass",
    name: "Grants Pass",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "24420",
    cbsaNameIncludes: ["grants pass", "or"],
    center: { lat: 42.4394, lng: -123.3284 },
    localities: [
      { city: "Grants Pass", state: "Oregon", lat: 42.4394, lng: -123.3284 },
    ],
  },
  {
    slug: "corvallis-or",
    name: "Corvallis",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "18700",
    cbsaNameIncludes: ["corvallis", "or"],
    center: { lat: 44.5646, lng: -123.262 },
    localities: [
      { city: "Corvallis", state: "Oregon", lat: 44.5646, lng: -123.262 },
    ],
  },
  {
    slug: "albany-or",
    name: "Albany",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "10540",
    cbsaNameIncludes: ["albany", "or"],
    center: { lat: 44.6365, lng: -123.1059 },
    localities: [
      { city: "Albany", state: "Oregon", lat: 44.6365, lng: -123.1059 },
      { city: "Lebanon", state: "Oregon", lat: 44.5365, lng: -122.907 },
    ],
  },
  {
    slug: "roseburg-or",
    name: "Roseburg",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "40700",
    cbsaNameIncludes: ["roseburg", "or"],
    center: { lat: 43.2165, lng: -123.3417 },
    localities: [
      { city: "Roseburg", state: "Oregon", lat: 43.2165, lng: -123.3417 },
    ],
  },
  {
    slug: "klamath-falls",
    name: "Klamath Falls",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "28900",
    cbsaNameIncludes: ["klamath falls", "or"],
    center: { lat: 42.2249, lng: -121.7817 },
    localities: [
      { city: "Klamath Falls", state: "Oregon", lat: 42.2249, lng: -121.7817 },
    ],
  },
  {
    slug: "pendleton-hermiston",
    name: "Pendleton / Hermiston",
    states: ["Oregon"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "37820",
    cbsaNameIncludes: ["pendleton", "or"],
    center: { lat: 45.6721, lng: -118.7886 },
    localities: [
      { city: "Pendleton", state: "Oregon", lat: 45.6721, lng: -118.7886 },
      { city: "Hermiston", state: "Oregon", lat: 45.8404, lng: -119.2895 },
    ],
  },

  // --- Washington ---
  {
    slug: "seattle-tacoma",
    name: "Seattle / Tacoma",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "42660",
    cbsaNameIncludes: ["seattle", "tacoma", "bellevue"],
    center: { lat: 47.6062, lng: -122.3321 },
    localities: [
      { city: "Seattle", state: "Washington", lat: 47.6062, lng: -122.3321 },
      { city: "Tacoma", state: "Washington", lat: 47.2529, lng: -122.4443 },
      { city: "Bellevue", state: "Washington", lat: 47.6101, lng: -122.2015 },
      { city: "Kent", state: "Washington", lat: 47.3809, lng: -122.2348 },
      { city: "Everett", state: "Washington", lat: 47.9789, lng: -122.2021 },
    ],
  },
  {
    slug: "spokane",
    name: "Spokane",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "44060",
    cbsaNameIncludes: ["spokane", "wa"],
    center: { lat: 47.6588, lng: -117.426 },
    localities: [
      { city: "Spokane", state: "Washington", lat: 47.6588, lng: -117.426 },
      { city: "Spokane Valley", state: "Washington", lat: 47.6733, lng: -117.2394 },
    ],
  },
  {
    slug: "tri-cities-wa",
    name: "Tri-Cities",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "28420",
    cbsaNameIncludes: ["kennewick", "richland"],
    center: { lat: 46.2112, lng: -119.1372 },
    localities: [
      { city: "Kennewick", state: "Washington", lat: 46.2112, lng: -119.1372 },
      { city: "Pasco", state: "Washington", lat: 46.2396, lng: -119.1006 },
      { city: "Richland", state: "Washington", lat: 46.2857, lng: -119.2845 },
    ],
  },
  {
    slug: "yakima",
    name: "Yakima",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "49420",
    cbsaNameIncludes: ["yakima", "wa"],
    center: { lat: 46.6021, lng: -120.5059 },
    localities: [
      { city: "Yakima", state: "Washington", lat: 46.6021, lng: -120.5059 },
    ],
  },
  {
    slug: "wenatchee",
    name: "Wenatchee",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "48300",
    cbsaNameIncludes: ["wenatchee", "wa"],
    center: { lat: 47.4235, lng: -120.3103 },
    localities: [
      { city: "Wenatchee", state: "Washington", lat: 47.4235, lng: -120.3103 },
      { city: "East Wenatchee", state: "Washington", lat: 47.4157, lng: -120.2931 },
    ],
  },
  {
    slug: "bellingham",
    name: "Bellingham",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "13380",
    cbsaNameIncludes: ["bellingham", "wa"],
    center: { lat: 48.7519, lng: -122.4787 },
    localities: [
      { city: "Bellingham", state: "Washington", lat: 48.7519, lng: -122.4787 },
    ],
  },
  {
    slug: "olympia",
    name: "Olympia",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "36500",
    cbsaNameIncludes: ["olympia", "lacey"],
    center: { lat: 47.0379, lng: -122.9007 },
    localities: [
      { city: "Olympia", state: "Washington", lat: 47.0379, lng: -122.9007 },
      { city: "Lacey", state: "Washington", lat: 47.0343, lng: -122.8232 },
      { city: "Tumwater", state: "Washington", lat: 47.0073, lng: -122.9093 },
    ],
  },
  {
    slug: "mount-vernon",
    name: "Mount Vernon / Anacortes",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "34580",
    cbsaNameIncludes: ["mount vernon", "anacortes"],
    center: { lat: 48.4212, lng: -122.334 },
    localities: [
      { city: "Mount Vernon", state: "Washington", lat: 48.4212, lng: -122.334 },
      { city: "Anacortes", state: "Washington", lat: 48.5126, lng: -122.6127 },
    ],
  },
  {
    slug: "longview-wa",
    name: "Longview",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "31020",
    cbsaNameIncludes: ["longview", "wa"],
    center: { lat: 46.1382, lng: -122.9382 },
    localities: [
      { city: "Longview", state: "Washington", lat: 46.1382, lng: -122.9382 },
      { city: "Kelso", state: "Washington", lat: 46.1468, lng: -122.9084 },
    ],
  },
  {
    slug: "walla-walla",
    name: "Walla Walla",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "47460",
    cbsaNameIncludes: ["walla walla", "wa"],
    center: { lat: 46.0646, lng: -118.343 },
    localities: [
      { city: "Walla Walla", state: "Washington", lat: 46.0646, lng: -118.343 },
    ],
  },
  {
    slug: "moses-lake",
    name: "Moses Lake",
    states: ["Washington"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "34180",
    cbsaNameIncludes: ["moses lake", "wa"],
    center: { lat: 47.1301, lng: -119.2781 },
    localities: [
      { city: "Moses Lake", state: "Washington", lat: 47.1301, lng: -119.2781 },
      { city: "Ephrata", state: "Washington", lat: 47.3176, lng: -119.5514 },
    ],
  },

  // --- Utah ---
  {
    slug: "salt-lake-city",
    name: "Salt Lake City Metro",
    states: ["Utah"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "41620",
    cbsaNameIncludes: ["salt lake city", "ut"],
    center: { lat: 40.7608, lng: -111.891 },
    localities: [
      { city: "Salt Lake City", state: "Utah", lat: 40.7608, lng: -111.891 },
      { city: "West Valley City", state: "Utah", lat: 40.6916, lng: -112.001 },
      { city: "West Jordan", state: "Utah", lat: 40.6097, lng: -111.9391 },
      { city: "Sandy", state: "Utah", lat: 40.5649, lng: -111.8389 },
    ],
  },
  {
    slug: "provo-orem",
    name: "Provo / Orem",
    states: ["Utah"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "39340",
    cbsaNameIncludes: ["provo", "orem"],
    center: { lat: 40.2338, lng: -111.6585 },
    localities: [
      { city: "Provo", state: "Utah", lat: 40.2338, lng: -111.6585 },
      { city: "Orem", state: "Utah", lat: 40.2969, lng: -111.6946 },
      { city: "Lehi", state: "Utah", lat: 40.3916, lng: -111.8508 },
    ],
  },
  {
    slug: "ogden-clearfield",
    name: "Ogden / Clearfield",
    states: ["Utah"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "36260",
    cbsaNameIncludes: ["ogden", "clearfield"],
    center: { lat: 41.223, lng: -111.9738 },
    localities: [
      { city: "Ogden", state: "Utah", lat: 41.223, lng: -111.9738 },
      { city: "Layton", state: "Utah", lat: 41.0602, lng: -111.9711 },
      { city: "Clearfield", state: "Utah", lat: 41.1108, lng: -112.0261 },
    ],
  },
  {
    slug: "st-george-ut",
    name: "St. George",
    states: ["Utah"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "41100",
    cbsaNameIncludes: ["st. george", "ut"],
    center: { lat: 37.0965, lng: -113.5684 },
    localities: [
      { city: "St. George", state: "Utah", lat: 37.0965, lng: -113.5684 },
      { city: "Washington", state: "Utah", lat: 37.1305, lng: -113.5083 },
    ],
  },
  {
    slug: "logan-ut",
    name: "Logan",
    states: ["Utah"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "30860",
    cbsaNameIncludes: ["logan", "ut"],
    center: { lat: 41.7355, lng: -111.8344 },
    localities: [
      { city: "Logan", state: "Utah", lat: 41.7355, lng: -111.8344 },
    ],
  },
  {
    slug: "cedar-city",
    name: "Cedar City",
    states: ["Utah"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "16260",
    cbsaNameIncludes: ["cedar city", "ut"],
    center: { lat: 37.6775, lng: -113.0619 },
    localities: [
      { city: "Cedar City", state: "Utah", lat: 37.6775, lng: -113.0619 },
    ],
  },
  {
    slug: "heber-ut",
    name: "Heber City",
    states: ["Utah"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "25720",
    cbsaNameIncludes: ["heber", "ut"],
    center: { lat: 40.5069, lng: -111.4133 },
    localities: [
      { city: "Heber City", state: "Utah", lat: 40.5069, lng: -111.4133 },
      { city: "Park City", state: "Utah", lat: 40.6461, lng: -111.498 },
    ],
  },

  // --- Nevada ---
  {
    slug: "las-vegas",
    name: "Las Vegas",
    states: ["Nevada"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "29820",
    cbsaNameIncludes: ["las vegas", "henderson"],
    center: { lat: 36.1699, lng: -115.1398 },
    localities: [
      { city: "Las Vegas", state: "Nevada", lat: 36.1699, lng: -115.1398 },
      { city: "Henderson", state: "Nevada", lat: 36.0395, lng: -114.9817 },
      { city: "North Las Vegas", state: "Nevada", lat: 36.1989, lng: -115.1175 },
    ],
  },
  {
    slug: "reno-sparks",
    name: "Reno / Sparks",
    states: ["Nevada"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "39900",
    cbsaNameIncludes: ["reno", "nv"],
    center: { lat: 39.5296, lng: -119.8138 },
    localities: [
      { city: "Reno", state: "Nevada", lat: 39.5296, lng: -119.8138 },
      { city: "Sparks", state: "Nevada", lat: 39.5349, lng: -119.7527 },
    ],
  },
  {
    slug: "carson-city",
    name: "Carson City",
    states: ["Nevada"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "16180",
    cbsaNameIncludes: ["carson city", "nv"],
    center: { lat: 39.1638, lng: -119.7674 },
    localities: [
      { city: "Carson City", state: "Nevada", lat: 39.1638, lng: -119.7674 },
    ],
  },
  {
    slug: "elko-nv",
    name: "Elko",
    states: ["Nevada"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "21220",
    cbsaNameIncludes: ["elko", "nv"],
    center: { lat: 40.8324, lng: -115.7631 },
    localities: [
      { city: "Elko", state: "Nevada", lat: 40.8324, lng: -115.7631 },
    ],
  },
  {
    slug: "pahrump",
    name: "Pahrump",
    states: ["Nevada"],
    timezone: "America/Los_Angeles",
    marketType: "metro",
    cbsaCode: "37220",
    cbsaNameIncludes: ["pahrump", "nv"],
    center: { lat: 36.2083, lng: -115.9839 },
    localities: [
      { city: "Pahrump", state: "Nevada", lat: 36.2083, lng: -115.9839 },
    ],
  },

  // --- Montana ---
  {
    slug: "billings",
    name: "Billings",
    states: ["Montana"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "13740",
    cbsaNameIncludes: ["billings", "mt"],
    center: { lat: 45.7833, lng: -108.5007 },
    localities: [
      { city: "Billings", state: "Montana", lat: 45.7833, lng: -108.5007 },
    ],
  },
  {
    slug: "missoula",
    name: "Missoula",
    states: ["Montana"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "33540",
    cbsaNameIncludes: ["missoula", "mt"],
    center: { lat: 46.8721, lng: -113.994 },
    localities: [
      { city: "Missoula", state: "Montana", lat: 46.8721, lng: -113.994 },
    ],
  },
  {
    slug: "bozeman",
    name: "Bozeman",
    states: ["Montana"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "14580",
    cbsaNameIncludes: ["bozeman", "mt"],
    center: { lat: 45.677, lng: -111.0429 },
    localities: [
      { city: "Bozeman", state: "Montana", lat: 45.677, lng: -111.0429 },
      { city: "Belgrade", state: "Montana", lat: 45.776, lng: -111.176 },
    ],
  },
  {
    slug: "great-falls",
    name: "Great Falls",
    states: ["Montana"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "24500",
    cbsaNameIncludes: ["great falls", "mt"],
    center: { lat: 47.5053, lng: -111.3008 },
    localities: [
      { city: "Great Falls", state: "Montana", lat: 47.5053, lng: -111.3008 },
    ],
  },
  {
    slug: "kalispell",
    name: "Kalispell",
    states: ["Montana"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "28060",
    cbsaNameIncludes: ["kalispell", "mt"],
    center: { lat: 48.1958, lng: -114.3129 },
    localities: [
      { city: "Kalispell", state: "Montana", lat: 48.1958, lng: -114.3129 },
      { city: "Whitefish", state: "Montana", lat: 48.4111, lng: -114.3376 },
    ],
  },
  {
    slug: "helena-mt",
    name: "Helena",
    states: ["Montana"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "25740",
    cbsaNameIncludes: ["helena", "mt"],
    center: { lat: 46.5891, lng: -112.0391 },
    localities: [
      { city: "Helena", state: "Montana", lat: 46.5891, lng: -112.0391 },
    ],
  },
  {
    slug: "butte-mt",
    name: "Butte",
    states: ["Montana"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "15580",
    cbsaNameIncludes: ["butte", "mt"],
    center: { lat: 46.0038, lng: -112.5348 },
    localities: [
      { city: "Butte", state: "Montana", lat: 46.0038, lng: -112.5348 },
    ],
  },

  // --- Wyoming ---
  {
    slug: "cheyenne",
    name: "Cheyenne",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "16940",
    cbsaNameIncludes: ["cheyenne", "wy"],
    center: { lat: 41.14, lng: -104.8202 },
    localities: [
      { city: "Cheyenne", state: "Wyoming", lat: 41.14, lng: -104.8202 },
    ],
  },
  {
    slug: "casper",
    name: "Casper",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "16220",
    cbsaNameIncludes: ["casper", "wy"],
    center: { lat: 42.8666, lng: -106.3131 },
    localities: [
      { city: "Casper", state: "Wyoming", lat: 42.8666, lng: -106.3131 },
    ],
  },
  {
    slug: "gillette-wy",
    name: "Gillette",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "23940",
    cbsaNameIncludes: ["gillette", "wy"],
    center: { lat: 44.2911, lng: -105.5022 },
    localities: [
      { city: "Gillette", state: "Wyoming", lat: 44.2911, lng: -105.5022 },
    ],
  },
  {
    slug: "laramie",
    name: "Laramie",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "29660",
    cbsaNameIncludes: ["laramie", "wy"],
    center: { lat: 41.3114, lng: -105.5911 },
    localities: [
      { city: "Laramie", state: "Wyoming", lat: 41.3114, lng: -105.5911 },
    ],
  },
  {
    slug: "rock-springs",
    name: "Rock Springs",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "40540",
    cbsaNameIncludes: ["rock springs", "wy"],
    center: { lat: 41.5875, lng: -109.2029 },
    localities: [
      { city: "Rock Springs", state: "Wyoming", lat: 41.5875, lng: -109.2029 },
      { city: "Green River", state: "Wyoming", lat: 41.5286, lng: -109.4662 },
    ],
  },
  {
    slug: "sheridan-wy",
    name: "Sheridan",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "43260",
    cbsaNameIncludes: ["sheridan", "wy"],
    center: { lat: 44.7972, lng: -106.9562 },
    localities: [
      { city: "Sheridan", state: "Wyoming", lat: 44.7972, lng: -106.9562 },
    ],
  },
  {
    slug: "jackson-wy",
    name: "Jackson",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "27220",
    cbsaNameIncludes: ["jackson", "wy"],
    center: { lat: 43.4799, lng: -110.7624 },
    localities: [
      { city: "Jackson", state: "Wyoming", lat: 43.4799, lng: -110.7624 },
    ],
  },
  {
    slug: "riverton-wy",
    name: "Riverton",
    states: ["Wyoming"],
    timezone: "America/Denver",
    marketType: "metro",
    cbsaCode: "40180",
    cbsaNameIncludes: ["riverton", "wy"],
    center: { lat: 43.025, lng: -108.3801 },
    localities: [
      { city: "Riverton", state: "Wyoming", lat: 43.025, lng: -108.3801 },
      { city: "Lander", state: "Wyoming", lat: 42.833, lng: -108.7307 },
    ],
  },
];

export const OPPORTUNITY_MARKET_COUNT = OPPORTUNITY_MARKETS.length;

export function getOpportunityMarket(
  slug: string,
): OpportunityMarketDefinition | undefined {
  return OPPORTUNITY_MARKETS.find((m) => m.slug === slug);
}

export function opportunityStates(): string[] {
  return [
    ...new Set(OPPORTUNITY_MARKETS.flatMap((m) => m.states)),
  ].sort((a, b) => a.localeCompare(b));
}
