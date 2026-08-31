/**
 * Phase IIIA Part 1 — Validate ZCTA centroid membership for sample LOAs.
 * Usage: npx tsx scripts/validate-loa-zcta-approximation.ts
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import { distanceMiles } from "../src/lib/local-opportunity-areas";

config({ path: ".env.local" });

const ZCTA_GAZ = join(process.cwd(), "tmp/census/2024_Gaz_zcta_national.txt");

const SAMPLE_SLUGS = [
  "american-fork-orem-saratoga-springs-pleasant-grove-utah-provo-orem",
  "provo-orem-spanish-fork-pleasant-grove-utah-provo-orem",
  "eagle-mountain-saratoga-springs-utah-provo-orem",
  "boise-city-meridian-kuna-idaho-boise-metro",
  "nampa-meridian-caldwell-kuna-idaho-boise-metro",
  "eagle-idaho-boise-metro",
  "seattle-bellevue-kirkland-shoreline-washington-seattle-tacoma",
  "billings-montana-billings",
  "casper-wyoming-casper",
];

async function loadZctaMeta(): Promise<
  Map<string, { lat: number; lng: number; landSqMi: number }>
> {
  if (!existsSync(ZCTA_GAZ)) {
    throw new Error(`Missing ${ZCTA_GAZ}`);
  }
  const map = new Map<string, { lat: number; lng: number; landSqMi: number }>();
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
    map.set(zip, { lat, lng, landSqMi: Number.isFinite(land) ? land : 0 });
  }
  return map;
}

async function main() {
  const gaz = await loadZctaMeta();
  const db = await connectAdminPg();
  try {
    const { rows: loas } = await db.query<{
      slug: string;
      display_name: string;
      center_lat: number;
      center_lng: number;
      population: number;
      zcta_codes: string[];
    }>(
      `select slug, display_name, center_lat::float, center_lng::float, population, zcta_codes
       from local_opportunity_areas
       where slug = any($1::text[])`,
      [SAMPLE_SLUGS],
    );

    const report: unknown[] = [];

    for (const loa of loas) {
      const zips = loa.zcta_codes ?? [];
      const { rows: demo } = await db.query<{
        zip_code: string;
        population: number | null;
        distance_miles: number | null;
      }>(
        `select z.zip_code, z.population, z.distance_miles::float
         from loa_zctas z
         join local_opportunity_areas l on l.id = z.loa_id
         where l.slug = $1
         order by z.population desc nulls last`,
        [loa.slug],
      );

      const details = demo.map((d) => {
        const meta = gaz.get(d.zip_code);
        const equivRadius =
          meta && meta.landSqMi > 0
            ? Math.sqrt(meta.landSqMi / Math.PI)
            : null;
        // Rough flag: large land area AND centroid near edge of 15mi circle
        const dist = d.distance_miles ?? 0;
        const suspicious =
          (meta?.landSqMi ?? 0) >= 80 &&
          dist >= 8 &&
          equivRadius !== null &&
          dist + equivRadius * 0.5 > 15;

        return {
          zip: d.zip_code,
          population: d.population,
          centroidMiles: d.distance_miles,
          landSqMi: meta?.landSqMi ?? null,
          approxEquivRadiusMiles: equivRadius
            ? Number(equivRadius.toFixed(1))
            : null,
          suspiciousInflator: suspicious,
        };
      });

      const top = details.slice(0, 8);
      const suspicious = details.filter((d) => d.suspiciousInflator);
      const popFromSuspicious = suspicious.reduce(
        (s, d) => s + (d.population ?? 0),
        0,
      );
      const shareSuspicious =
        loa.population && loa.population > 0
          ? popFromSuspicious / loa.population
          : null;

      // Compactness: share of pop in ZCTAs with centroid ≤10mi
      const innerPop = details
        .filter((d) => (d.centroidMiles ?? 99) <= 10)
        .reduce((s, d) => s + (d.population ?? 0), 0);
      const outerPop = details
        .filter((d) => (d.centroidMiles ?? 0) > 10)
        .reduce((s, d) => s + (d.population ?? 0), 0);

      report.push({
        loa: loa.display_name,
        slug: loa.slug,
        center: { lat: loa.center_lat, lng: loa.center_lng },
        totalPopulation: loa.population,
        zctaCount: zips.length,
        popInCentroidsWithin10mi: innerPop,
        popInCentroids10to15mi: outerPop,
        outerShare:
          loa.population && loa.population > 0
            ? Number((outerPop / loa.population).toFixed(3))
            : null,
        suspiciousZctaCount: suspicious.length,
        suspiciousPopShare: shareSuspicious
          ? Number(shareSuspicious.toFixed(3))
          : null,
        topZctasByPop: top,
        suspiciousZctas: suspicious,
      });
    }

    console.log(JSON.stringify({ method: "ZCTA centroid ≤15mi", report }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
