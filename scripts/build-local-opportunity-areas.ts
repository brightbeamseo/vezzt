/**
 * Build Local Opportunity Areas (Phase II).
 *
 * - Generate ~100–150 centers from Census places under existing macro markets
 * - 15-mile radius demographics via ZCTA centroid membership + ACS aggregation
 * - No Apify / paid discovery
 *
 * Usage: npm run build:local-opportunity-areas
 */
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  CENSUS_API_KEY_CLI_MISSING_MESSAGE,
  isCensusApiKeyConfigured,
  parseCensusNumber,
  requireCensusApiKey,
} from "../src/lib/census";
import {
  LOA_RADIUS_MILES,
  STATE_FIPS,
  aggregateZctaDemographics,
  cleanPlaceName,
  distanceMiles,
  selectCentersForMarket,
  zctasWithinRadius,
  type PlaceCandidate,
  type SelectedCenter,
  type ZctaDemo,
  type ZctaPoint,
} from "../src/lib/local-opportunity-areas";

config({ path: ".env.local" });

const TMP = join(process.cwd(), "tmp", "census");
const PLACE_GAZ = join(TMP, "2024_Gaz_place_national.txt");
const ZCTA_GAZ = join(TMP, "2024_Gaz_zcta_national.txt");

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
] as const;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureGazetteers() {
  mkdirSync(TMP, { recursive: true });
  if (!existsSync(PLACE_GAZ)) {
    console.log("Downloading Census place gazetteer…");
    execSync(
      `curl -sSL -o "${join(TMP, "gaz_place.zip")}" "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip" && unzip -o "${join(TMP, "gaz_place.zip")}" -d "${TMP}"`,
      { stdio: "inherit" },
    );
  }
  if (!existsSync(ZCTA_GAZ)) {
    console.log("Downloading Census ZCTA gazetteer…");
    execSync(
      `curl -sSL -o "${join(TMP, "gaz_zcta.zip")}" "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip" && unzip -o "${join(TMP, "gaz_zcta.zip")}" -d "${TMP}"`,
      { stdio: "inherit" },
    );
  }
}

async function readTsv(
  path: string,
): Promise<Record<string, string>[]> {
  const rows: Record<string, string>[] = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
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
    rows.push(obj);
  }
  return rows;
}

async function loadPlaceGazetteer(
  states: Set<string>,
): Promise<Map<string, { lat: number; lng: number; landSqMi: number; name: string; usps: string }>> {
  const rows = await readTsv(PLACE_GAZ);
  const map = new Map<
    string,
    { lat: number; lng: number; landSqMi: number; name: string; usps: string }
  >();
  for (const r of rows) {
    const usps = r.USPS;
    const abbrevToName: Record<string, string> = {
      ID: "Idaho",
      OR: "Oregon",
      WA: "Washington",
      UT: "Utah",
      WY: "Wyoming",
      NV: "Nevada",
      MT: "Montana",
    };
    const stateName = abbrevToName[usps];
    if (!stateName || !states.has(stateName)) continue;
    const geoid = r.GEOID;
    const lat = Number(r.INTPTLAT);
    const lng = Number(r.INTPTLONG);
    if (!geoid || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    map.set(geoid, {
      lat,
      lng,
      landSqMi: Number(r.ALAND_SQMI) || 0,
      name: r.NAME,
      usps,
    });
  }
  return map;
}

async function loadZctaGazetteer(): Promise<ZctaPoint[]> {
  const rows = await readTsv(ZCTA_GAZ);
  const out: ZctaPoint[] = [];
  for (const r of rows) {
    const zip = r.GEOID?.trim();
    const lat = Number(r.INTPTLAT);
    const lng = Number(r.INTPTLONG);
    if (!zip || zip.length !== 5 || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      continue;
    }
    out.push({ zipCode: zip, lat, lng });
  }
  return out;
}

async function fetchPlacePopulations(
  apiKey: string,
  stateFips: string,
): Promise<Array<{ geoid: string; name: string; population: number; place: string }>> {
  const url = `https://api.census.gov/data/2024/acs/acs5?get=NAME,B01003_001E&for=place:*&in=state:${stateFips}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok || !text.trim().startsWith("[")) {
    throw new Error(`Place ACS failed for state ${stateFips}: ${text.slice(0, 200)}`);
  }
  const table = JSON.parse(text) as string[][];
  const out: Array<{ geoid: string; name: string; population: number; place: string }> = [];
  for (const row of table.slice(1)) {
    const name = row[0] ?? "";
    const pop = parseCensusNumber(row[1]);
    const state = row[2] ?? stateFips;
    const place = row[3] ?? "";
    if (pop === null || !place) continue;
    out.push({
      geoid: `${state}${place}`,
      name,
      population: pop,
      place,
    });
  }
  return out;
}

async function fetchZctaBatch(
  apiKey: string,
  year: number,
  zips: string[],
): Promise<ZctaDemo[]> {
  if (zips.length === 0) return [];
  if (year <= 2019) {
    throw new Error(
      "ACS ≤2019 ZCTA batches require state qualification — use fetchStateZctaYear",
    );
  }
  const params = new URLSearchParams();
  params.set("get", ZCTA_VARS.join(","));
  params.set("for", `zip code tabulation area:${zips.join(",")}`);
  params.set("key", apiKey);
  const url = `https://api.census.gov/data/${year}/acs/acs5?${params.toString()}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok || !text.trim().startsWith("[")) {
    throw new Error(`ZCTA ACS ${year} failed: ${text.slice(0, 200)}`);
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

/** ACS ≤2019: pull all ZCTAs for a state, then filter. */
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
    throw new Error(
      `State ZCTA ACS ${year} state ${stateFips} failed: ${text.slice(0, 200)}`,
    );
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

async function fetchAllZctaDemos(
  apiKey: string,
  year: number,
  zips: string[],
): Promise<Map<string, ZctaDemo>> {
  const map = new Map<string, ZctaDemo>();
  const unique = [...new Set(zips)].sort();
  const batchSize = 40;
  for (let i = 0; i < unique.length; i += batchSize) {
    const batch = unique.slice(i, i + batchSize);
    try {
      const rows = await fetchZctaBatch(apiKey, year, batch);
      for (const r of rows) map.set(r.zipCode, r);
    } catch (err) {
      console.error(
        `ZCTA batch ${year} failed (${batch[0]}…):`,
        err instanceof Error ? err.message : err,
      );
    }
    await sleep(150);
  }
  return map;
}

function assignPlaceToNearestMarket(
  place: PlaceCandidate,
  markets: Array<{
    id: string;
    slug: string;
    name: string;
    states: string[];
    center: { lat: number; lng: number };
    population: number | null;
  }>,
): (typeof markets)[number] | null {
  let best: { market: (typeof markets)[number]; score: number } | null = null;
  for (const m of markets) {
    if (!m.states.includes(place.state)) continue;
    const pop = m.population ?? 50_000;
    const catchment = Math.min(75, Math.max(30, 25 + pop / 35_000));
    const dist = distanceMiles(
      { lat: place.lat, lng: place.lng },
      m.center,
    );
    if (dist > catchment) continue;
    // Gravity: larger metros attract places farther away (fixes Lakewood→Olympia).
    const score = pop / (dist + 8) ** 2;
    if (!best || score > best.score) best = { market: m, score };
  }
  return best?.market ?? null;
}

async function main() {
  if (!isCensusApiKeyConfigured()) {
    console.log(CENSUS_API_KEY_CLI_MISSING_MESSAGE);
    process.exit(0);
  }
  const apiKey = requireCensusApiKey();
  ensureGazetteers();

  const db = await connectAdminPg();

  try {
    const marketRes = await db.query<{
      id: string;
      market_slug: string;
      market_name: string;
      states: string[] | null;
      state: string | null;
      center_lat: string | null;
      center_lng: string | null;
      population: number | null;
    }>(
      `select id, market_slug, market_name, states, state, center_lat, center_lng, population
       from public.markets
       where opportunity_enabled = true
       order by population desc nulls last`,
    );

    const markets = marketRes.rows.map((m) => ({
      id: m.id,
      slug: m.market_slug,
      name: m.market_name,
      states:
        m.states && m.states.length > 0
          ? m.states
          : m.state
            ? [m.state]
            : [],
      center: {
        lat: Number(m.center_lat),
        lng: Number(m.center_lng),
      },
      population: m.population,
    })).filter((m) => Number.isFinite(m.center.lat) && Number.isFinite(m.center.lng));

    const stateNames = new Set(markets.flatMap((m) => m.states));
    console.log(`Macro markets: ${markets.length}; states: ${[...stateNames].join(", ")}`);

    console.log("Loading gazetteers…");
    const placeGaz = await loadPlaceGazetteer(stateNames);
    const zctaGaz = await loadZctaGazetteer();
    console.log(`Places gaz: ${placeGaz.size}; ZCTAs: ${zctaGaz.length}`);

    console.log("Fetching ACS place populations…");
    const placeCandidates: PlaceCandidate[] = [];
    for (const [stateName, fips] of Object.entries(STATE_FIPS)) {
      if (!stateNames.has(stateName)) continue;
      const pops = await fetchPlacePopulations(apiKey, fips);
      for (const p of pops) {
        const gaz = placeGaz.get(p.geoid);
        if (!gaz) continue;
        const rawName = p.name.replace(new RegExp(`,\\s*${stateName}$`, "i"), "");
        placeCandidates.push({
          geoid: p.geoid,
          name: p.name,
          displayCity: cleanPlaceName(rawName),
          state: stateName,
          stateFips: fips,
          lat: gaz.lat,
          lng: gaz.lng,
          population: p.population,
          landSqMi: gaz.landSqMi,
        });
      }
      console.log(`  ${stateName}: ${pops.length} places with ACS pop`);
      await sleep(200);
    }
    console.log(`Place candidates with coords: ${placeCandidates.length}`);

    // Select centers per macro market (places assigned to nearest market).
    const byMarket = new Map<string, PlaceCandidate[]>();
    const unassigned: PlaceCandidate[] = [];
    for (const place of placeCandidates) {
      const m = assignPlaceToNearestMarket(place, markets);
      if (!m) {
        unassigned.push(place);
        continue;
      }
      const list = byMarket.get(m.id) ?? [];
      list.push(place);
      byMarket.set(m.id, list);
    }

    const allSelected: SelectedCenter[] = [];
    const allSuppressed: Array<{
      market: string;
      place: string;
      pop: number;
      reason: string;
    }> = [];
    let rank = 1;

    for (const m of markets) {
      const { selected, suppressed } = selectCentersForMarket({
        macroMarketId: m.id,
        macroMarketSlug: m.slug,
        macroMarketName: m.name,
        marketCenter: m.center,
        marketPopulation: m.population,
        marketStates: m.states,
        candidates: byMarket.get(m.id) ?? [],
        startRank: rank,
      });
      rank += selected.length;
      allSelected.push(...selected);
      for (const s of suppressed) {
        allSuppressed.push({
          market: m.name,
          place: s.place.displayCity,
          pop: s.place.population,
          reason: s.reason,
        });
      }
    }

    // Deduplicate slugs
    const slugCount = new Map<string, number>();
    for (const s of allSelected) {
      const n = (slugCount.get(s.slug) ?? 0) + 1;
      slugCount.set(s.slug, n);
      if (n > 1) s.slug = `${s.slug}-${n}`;
    }

    console.log(
      `\nSelected LOAs: ${allSelected.length} (suppressed place candidates: ${allSuppressed.length})`,
    );

    // Collect all ZCTAs needed
    const loaZctaMap = new Map<
      string,
      Array<ZctaPoint & { distanceMiles: number }>
    >();
    const allZips = new Set<string>();
    for (const s of allSelected) {
      const zs = zctasWithinRadius(
        { lat: s.place.lat, lng: s.place.lng },
        zctaGaz,
        LOA_RADIUS_MILES,
      );
      loaZctaMap.set(s.slug, zs);
      for (const z of zs) allZips.add(z.zipCode);
    }
    console.log(`Unique ZCTAs intersecting LOAs: ${allZips.size}`);

    console.log("Fetching ACS 2024 ZCTA demographics…");
    const currentMap = await fetchAllZctaDemos(apiKey, 2024, [...allZips]);
    console.log(`  matched ${currentMap.size}`);
    console.log("Fetching ACS 2019 ZCTA demographics by state (growth baseline)…");
    const baselineMap = new Map<string, ZctaDemo>();
    for (const [stateName, fips] of Object.entries(STATE_FIPS)) {
      if (!stateNames.has(stateName)) continue;
      try {
        const stateMap = await fetchStateZctaYear(apiKey, 2019, fips);
        let kept = 0;
        for (const zip of allZips) {
          const row = stateMap.get(zip);
          if (row) {
            baselineMap.set(zip, row);
            kept += 1;
          }
        }
        console.log(`  ${stateName}: ${stateMap.size} ZCTAs, kept ${kept} for LOAs`);
      } catch (err) {
        console.error(
          `  ${stateName} 2019 failed:`,
          err instanceof Error ? err.message : err,
        );
      }
      await sleep(300);
    }
    console.log(`  baseline matched ${baselineMap.size}`);

    // Replace LOA tables
    await db.query(`delete from public.local_opportunity_areas`);

    let inserted = 0;
    for (const s of allSelected) {
      const zs = loaZctaMap.get(s.slug) ?? [];
      const current = zs
        .map((z) => currentMap.get(z.zipCode))
        .filter((d): d is ZctaDemo => Boolean(d));
      const baseline = zs
        .map((z) => baselineMap.get(z.zipCode))
        .filter((d): d is ZctaDemo => Boolean(d));
      const agg = aggregateZctaDemographics({ current, baseline });

      const { rows } = await db.query<{ id: string }>(
        `insert into public.local_opportunity_areas (
          slug, display_name, state, macro_market_id,
          center_lat, center_lng, radius_miles,
          place_geoid, place_name, place_population, selection_rank, companion_places,
          population, households, housing_units, owner_occupied_units,
          owner_occupied_rate, owner_occupied_per_1k_residents,
          median_household_income, median_home_value, median_year_structure_built,
          single_family_detached_units, single_family_share,
          population_growth, household_growth, housing_growth,
          zcta_count, zcta_codes,
          dataset_year, baseline_dataset_year, data_source, aggregation_method,
          last_updated, raw_response, updated_at
        ) values (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
          $27,$28,$29,$30,$31,$32, now(), $33::jsonb, now()
        ) returning id`,
        [
          s.slug,
          s.displayName,
          s.place.state,
          s.macroMarketId,
          s.place.lat,
          s.place.lng,
          LOA_RADIUS_MILES,
          s.place.geoid,
          s.place.name,
          s.place.population,
          s.selectionRank,
          s.companions.map((c) => c.displayCity),
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
          2024,
          2019,
          "US Census ACS 5-Year (ZCTA aggregation, 2019→2024)",
          agg.aggregationMethod,
          JSON.stringify({
            companions: s.companions.map((c) => ({
              city: c.displayCity,
              pop: c.population,
            })),
            macroMarket: s.macroMarketSlug,
            zctaDistances: zs.map((z) => ({
              zip: z.zipCode,
              miles: Number(z.distanceMiles.toFixed(2)),
            })),
          }),
        ],
      );

      const loaId = rows[0]!.id;
      for (const z of zs) {
        const demo = currentMap.get(z.zipCode);
        await db.query(
          `insert into public.loa_zctas (loa_id, zip_code, distance_miles, population, households)
           values ($1,$2,$3,$4,$5)
           on conflict do nothing`,
          [
            loaId,
            z.zipCode,
            Number(z.distanceMiles.toFixed(3)),
            demo?.population ?? null,
            demo?.households ?? null,
          ],
        );
      }
      inserted += 1;
    }

    // Report samples
    const provo = await db.query(
      `select l.display_name, l.state, m.market_name, l.center_lat, l.center_lng,
              l.population, round(l.population_growth::numeric,1) as pop_g,
              l.owner_occupied_units, round(l.owner_occupied_rate::numeric,1) as own_pct,
              round(l.median_household_income) as mhi, l.zcta_count
       from local_opportunity_areas l
       join markets m on m.id = l.macro_market_id
       where m.market_slug = 'provo-orem'
       order by l.population desc nulls last`,
    );
    const boise = await db.query(
      `select l.display_name, l.state, m.market_name, l.center_lat, l.center_lng,
              l.population, round(l.population_growth::numeric,1) as pop_g,
              l.owner_occupied_units, round(l.owner_occupied_rate::numeric,1) as own_pct,
              round(l.median_household_income) as mhi, l.zcta_count
       from local_opportunity_areas l
       join markets m on m.id = l.macro_market_id
       where m.market_slug = 'boise-metro'
       order by l.population desc nulls last`,
    );
    const seattle = await db.query(
      `select l.display_name, l.state, m.market_name,
              l.population, round(l.population_growth::numeric,1) as pop_g,
              l.owner_occupied_units, l.zcta_count
       from local_opportunity_areas l
       join markets m on m.id = l.macro_market_id
       where m.market_slug = 'seattle-tacoma'
       order by l.population desc nulls last`,
    );

    const byState = await db.query(
      `select state, count(*)::int as n from local_opportunity_areas group by state order by state`,
    );

    const topSuppressed = allSuppressed
      .sort((a, b) => b.pop - a.pop)
      .slice(0, 25);

    console.log("\n=== Local Opportunity Areas report ===");
    console.log(
      JSON.stringify(
        {
          totalLoas: inserted,
          radiusMiles: LOA_RADIUS_MILES,
          byState: byState.rows,
          uniqueZctas: allZips.size,
          unassignedPlacesOver8k: unassigned.filter((p) => p.population >= 8000)
            .length,
          provoOremSample: provo.rows,
          boiseSample: boise.rows,
          seattleSample: seattle.rows,
          topSuppressedExamples: topSuppressed,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
