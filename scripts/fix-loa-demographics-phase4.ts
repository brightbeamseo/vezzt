/**
 * Phase IV — Fix flagged LOA demographics with simplest Census corrections.
 *
 * Undercoverage (sparse rural): include ZCTAs whose approximate footprint
 * intersects the 15mi circle even if the centroid is outside
 * (dist - 0.65*sqrt(land/π) ≤ 15), same state only.
 *
 * Overcoverage (Boulder City): keep only the local city ZCTA (89005).
 *
 * Usage: npm run fix:loa-demographics
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  isCensusApiKeyConfigured,
  parseCensusNumber,
  requireCensusApiKey,
  CENSUS_API_KEY_CLI_MISSING_MESSAGE,
} from "../src/lib/census";
import {
  aggregateZctaDemographics,
  distanceMiles,
  type ZctaDemo,
} from "../src/lib/local-opportunity-areas";

config({ path: ".env.local" });

const ZCTA_GAZ = join(process.cwd(), "tmp/census/2024_Gaz_zcta_national.txt");
const RADIUS = 15;
const SOFT_FACTOR = 0.65;

const ZCTA_VARS = [
  "NAME",
  "B01003_001E",
  "B11001_001E",
  "B25001_001E",
  "B25003_002E",
  "B19013_001E",
  "B25077_001E",
  "B25035_001E",
  "B25024_002E",
];

/** State FIPS → allowed ZIP prefix heuristic is weak; use explicit state→ZCTA list from soft intersect filtered by known state ZIP ranges. */
const STATE_ZIP_PREFIXES: Record<string, string[]> = {
  Idaho: ["83"],
  Oregon: ["97"],
  Nevada: ["89"],
  Wyoming: ["82", "83"], // WY mostly 82/83
  Montana: ["59"],
  Utah: ["84"],
  Washington: ["98", "99"],
};

type GazZcta = {
  zip: string;
  lat: number;
  lng: number;
  landSqMi: number;
};

type FixPlan =
  | { slug: string; method: "soft_intersect_15mi"; state: string }
  | { slug: string; method: "manual_local_zcta"; zips: string[]; note: string };

const FIX_PLANS: FixPlan[] = [
  { slug: "casper-wyoming-casper", method: "soft_intersect_15mi", state: "Wyoming" },
  { slug: "cheyenne-wyoming-cheyenne", method: "soft_intersect_15mi", state: "Wyoming" },
  { slug: "gillette-wyoming-gillette-wy", method: "soft_intersect_15mi", state: "Wyoming" },
  { slug: "green-river-wyoming-rock-springs", method: "soft_intersect_15mi", state: "Wyoming" },
  { slug: "rock-springs-wyoming-rock-springs", method: "soft_intersect_15mi", state: "Wyoming" },
  { slug: "elko-nevada-elko-nv", method: "soft_intersect_15mi", state: "Nevada" },
  { slug: "prineville-oregon-bend-or", method: "soft_intersect_15mi", state: "Oregon" },
  { slug: "mountain-home-idaho-boise-metro", method: "soft_intersect_15mi", state: "Idaho" },
  {
    slug: "boulder-city-nevada-las-vegas",
    method: "manual_local_zcta",
    zips: ["89005"],
    note: "Exclude Las Vegas/Henderson-edge ZCTAs; retain Boulder City ZCTA 89005 only",
  },
];

async function loadGaz(): Promise<GazZcta[]> {
  if (!existsSync(ZCTA_GAZ)) throw new Error(`Missing ${ZCTA_GAZ}`);
  const out: GazZcta[] = [];
  const rl = createInterface({
    input: createReadStream(ZCTA_GAZ),
    crlfDelay: Infinity,
  });
  let headers: string[] | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = line.split("\t").map((c) => c.trim());
    if (!headers) {
      headers = cols;
      continue;
    }
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cols[i] ?? "";
    });
    const zip = obj.GEOID?.trim();
    const lat = Number(obj.INTPTLAT);
    const lng = Number(obj.INTPTLONG);
    const land = Number(obj.ALAND_SQMI);
    if (!zip || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      zip,
      lat,
      lng,
      landSqMi: Number.isFinite(land) ? land : 0,
    });
  }
  return out;
}

function zipAllowedForState(zip: string, state: string): boolean {
  const prefixes = STATE_ZIP_PREFIXES[state];
  if (!prefixes) return true;
  return prefixes.some((p) => zip.startsWith(p));
}

function softIntersectZips(
  center: { lat: number; lng: number },
  gaz: GazZcta[],
  state: string,
): Array<{ zip: string; distanceMiles: number }> {
  const selected: Array<{ zip: string; distanceMiles: number }> = [];
  for (const z of gaz) {
    if (!zipAllowedForState(z.zip, state)) continue;
    const dist = distanceMiles(center, { lat: z.lat, lng: z.lng });
    const equivR = z.landSqMi > 0 ? Math.sqrt(z.landSqMi / Math.PI) : 0;
    const intersects = dist - SOFT_FACTOR * equivR <= RADIUS;
    if (intersects) {
      selected.push({ zip: z.zip, distanceMiles: dist });
    }
  }
  return selected.sort((a, b) => a.distanceMiles - b.distanceMiles);
}

async function fetchZctaBatch(
  apiKey: string,
  year: number,
  zips: string[],
): Promise<ZctaDemo[]> {
  if (!zips.length) return [];
  if (year <= 2019) {
    throw new Error("Use state fetch for 2019");
  }
  const params = new URLSearchParams();
  params.set("get", ZCTA_VARS.join(","));
  params.set("for", `zip code tabulation area:${zips.join(",")}`);
  params.set("key", apiKey);
  const url = `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok || !text.trim().startsWith("[")) {
    throw new Error(`ACS ${year} failed: ${text.slice(0, 200)}`);
  }
  const table = JSON.parse(text) as string[][];
  const headers = table[0]!;
  const out: ZctaDemo[] = [];
  for (const row of table.slice(1)) {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    const zip = (obj["zip code tabulation area"] ?? "").trim();
    if (!zip) continue;
    out.push({
      zipCode: zip,
      population: parseCensusNumber(obj.B01003_001E),
      households: parseCensusNumber(obj.B11001_001E),
      housingUnits: parseCensusNumber(obj.B25001_001E),
      ownerOccupiedUnits: parseCensusNumber(obj.B25003_002E),
      medianHouseholdIncome: parseCensusNumber(obj.B19013_001E),
      medianHomeValue: parseCensusNumber(obj.B25077_001E),
      medianYearStructureBuilt: parseCensusNumber(obj.B25035_001E),
      singleFamilyDetachedUnits: parseCensusNumber(obj.B25024_002E),
    });
  }
  return out;
}

async function fetchStateZctaYear(
  apiKey: string,
  year: number,
  stateFips: string,
): Promise<Map<string, ZctaDemo>> {
  const params = new URLSearchParams();
  params.set("get", ZCTA_VARS.join(","));
  params.set("for", "zip code tabulation area:*");
  params.set("in", `state:${stateFips}`);
  params.set("key", apiKey);
  const url = `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok || !text.trim().startsWith("[")) {
    throw new Error(`State ACS ${year} ${stateFips}: ${text.slice(0, 200)}`);
  }
  const table = JSON.parse(text) as string[][];
  const headers = table[0]!;
  const map = new Map<string, ZctaDemo>();
  for (const row of table.slice(1)) {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    const zip = (obj["zip code tabulation area"] ?? "").trim();
    if (!zip) continue;
    map.set(zip, {
      zipCode: zip,
      population: parseCensusNumber(obj.B01003_001E),
      households: parseCensusNumber(obj.B11001_001E),
      housingUnits: parseCensusNumber(obj.B25001_001E),
      ownerOccupiedUnits: parseCensusNumber(obj.B25003_002E),
      medianHouseholdIncome: parseCensusNumber(obj.B19013_001E),
      medianHomeValue: parseCensusNumber(obj.B25077_001E),
      medianYearStructureBuilt: parseCensusNumber(obj.B25035_001E),
      singleFamilyDetachedUnits: parseCensusNumber(obj.B25024_002E),
    });
  }
  return map;
}

const STATE_FIPS: Record<string, string> = {
  Idaho: "16",
  Oregon: "41",
  Nevada: "32",
  Wyoming: "56",
  Montana: "30",
  Utah: "49",
  Washington: "53",
};

async function main() {
  if (!isCensusApiKeyConfigured()) {
    console.error(CENSUS_API_KEY_CLI_MISSING_MESSAGE);
    process.exit(1);
  }
  const apiKey = requireCensusApiKey();
  const gaz = await loadGaz();
  const db = await connectAdminPg();

  const results: unknown[] = [];

  for (const plan of FIX_PLANS) {
    const { rows: loaRows } = await db.query<{
      id: string;
      display_name: string;
      state: string;
      center_lat: number;
      center_lng: number;
      place_population: number | null;
      population: number | null;
      households: number | null;
      owner_occupied_units: number | null;
      zcta_codes: string[] | null;
      zcta_count: number | null;
      median_household_income: number | null;
      median_home_value: number | null;
    }>(
      `select id, display_name, state, center_lat::float, center_lng::float,
              place_population, population, households, owner_occupied_units,
              zcta_codes, zcta_count,
              median_household_income::float, median_home_value::float
       from local_opportunity_areas where slug = $1`,
      [plan.slug],
    );
    const loa = loaRows[0];
    if (!loa) {
      console.warn("Missing LOA", plan.slug);
      continue;
    }

    const pre = {
      population: loa.population,
      households: loa.households,
      ownerOccupiedUnits: loa.owner_occupied_units,
      zctaCodes: loa.zcta_codes,
      zctaCount: loa.zcta_count,
      medianHouseholdIncome: loa.median_household_income,
      medianHomeValue: loa.median_home_value,
    };

    let selected: Array<{ zip: string; distanceMiles: number }>;
    let methodNote: string;

    if (plan.method === "manual_local_zcta") {
      selected = plan.zips.map((zip) => {
        const g = gaz.find((z) => z.zip === zip);
        const dist = g
          ? distanceMiles(
              { lat: loa.center_lat, lng: loa.center_lng },
              { lat: g.lat, lng: g.lng },
            )
          : 0;
        return { zip, distanceMiles: dist };
      });
      methodNote = plan.note;
    } else {
      selected = softIntersectZips(
        { lat: loa.center_lat, lng: loa.center_lng },
        gaz,
        plan.state,
      );
      methodNote = `Soft-intersect ZCTA inclusion: centroid_dist - ${SOFT_FACTOR}*equivRadius ≤ ${RADIUS}mi (same-state ZIP prefixes). Was ${loa.zcta_count ?? 0} ZCTAs / pop ${loa.population}.`;
    }

    if (!selected.length) {
      console.warn("No ZCTAs for", plan.slug);
      continue;
    }

    console.log(
      `\n${loa.display_name}: ${selected.length} ZCTAs → ${selected.map((s) => s.zip).join(",")}`,
    );

    const zips = selected.map((s) => s.zip);
    const currentRows = await fetchZctaBatch(apiKey, 2024, zips);
    const currentMap = new Map(currentRows.map((r) => [r.zipCode, r]));

    const fips = STATE_FIPS[loa.state];
    let baselineMap = new Map<string, ZctaDemo>();
    if (fips) {
      baselineMap = await fetchStateZctaYear(apiKey, 2019, fips);
    }

    const current = zips
      .map((z) => currentMap.get(z))
      .filter((d): d is ZctaDemo => Boolean(d));
    const baseline = zips
      .map((z) => baselineMap.get(z))
      .filter((d): d is ZctaDemo => Boolean(d));

    const agg = aggregateZctaDemographics({ current, baseline });
    agg.aggregationMethod = `${methodNote} | ACS 2024 vs 2019`;

    await db.query("begin");
    try {
      await db.query(`delete from loa_zctas where loa_id = $1`, [loa.id]);
      for (const s of selected) {
        const demo = currentMap.get(s.zip);
        await db.query(
          `insert into loa_zctas (loa_id, zip_code, distance_miles, population, households)
           values ($1,$2,$3,$4,$5)`,
          [
            loa.id,
            s.zip,
            s.distanceMiles,
            demo?.population ?? null,
            demo?.households ?? null,
          ],
        );
      }

      await db.query(
        `update local_opportunity_areas set
          population = $2,
          households = $3,
          housing_units = $4,
          owner_occupied_units = $5,
          owner_occupied_rate = $6,
          owner_occupied_per_1k_residents = $7,
          median_household_income = $8,
          median_home_value = $9,
          median_year_structure_built = $10,
          single_family_detached_units = $11,
          single_family_share = $12,
          population_growth = $13,
          household_growth = $14,
          housing_growth = $15,
          zcta_count = $16,
          zcta_codes = $17,
          aggregation_method = $18,
          demo_quality_flag = 'corrected',
          demo_quality_notes = $19,
          demo_corrected = true,
          demo_correction_method = $20,
          demo_pre_correction = $21::jsonb,
          last_updated = now(),
          updated_at = now()
        where id = $1`,
        [
          loa.id,
          agg.population,
          agg.households,
          agg.housingUnits,
          agg.ownerOccupiedUnits,
          agg.ownerOccupiedRate,
          agg.ownerOccupiedPer1kResidents,
          agg.medianHouseholdIncome,
          agg.medianHomeValue,
          agg.medianYearStructureBuilt,
          agg.singleFamilyDetachedUnits,
          agg.singleFamilyShare,
          agg.populationGrowth,
          agg.householdGrowth,
          agg.housingGrowth,
          agg.zctaCount,
          agg.zctaCodes,
          agg.aggregationMethod,
          methodNote,
          plan.method,
          JSON.stringify(pre),
        ],
      );
      await db.query("commit");
    } catch (e) {
      await db.query("rollback");
      throw e;
    }

    const row = {
      loa: loa.display_name,
      slug: plan.slug,
      method: plan.method,
      before: pre,
      after: {
        population: agg.population,
        households: agg.households,
        ownerOccupiedUnits: agg.ownerOccupiedUnits,
        zctaCount: agg.zctaCount,
        zctaCodes: agg.zctaCodes,
        medianHouseholdIncome: agg.medianHouseholdIncome,
        medianHomeValue: agg.medianHomeValue,
        populationGrowth: agg.populationGrowth,
      },
      placePopulation: loa.place_population,
    };
    results.push(row);
    console.log(
      `  before pop=${pre.population} → after pop=${agg.population} (place ${loa.place_population}) zctas=${agg.zctaCount}`,
    );
  }

  console.log("\n=== CORRECTIONS ===");
  console.log(JSON.stringify(results, null, 2));
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
