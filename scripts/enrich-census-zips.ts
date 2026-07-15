/**
 * Fetch US Census ACS 5-Year ZCTA demographics for Boise Metro business ZIPs.
 * Upserts public.zip_code_stats. Does not invent values.
 *
 * Usage: npm run enrich:census-zips
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  CENSUS_DATA_SOURCE,
  CENSUS_DATASET_NAME,
  CENSUS_DATASET_YEAR,
  fetchCensusZctaStats,
  normalizeZipCode,
} from "../src/lib/census";

config({ path: ".env.local" });

async function main() {
  const apiKey = process.env.CENSUS_API_KEY?.trim() || null;
  if (!apiKey) {
    throw new Error(
      "Missing CENSUS_API_KEY. Census Data API now requires a free key for all queries.\n" +
        "1. Sign up: https://api.census.gov/data/key_signup.html\n" +
        "2. Add CENSUS_API_KEY=... to .env.local (server-side only)\n" +
        "3. Re-run: npm run enrich:census-zips",
    );
  }

  const db = await connectAdminPg();

  let uniqueZips: string[] = [];
  try {
    const { rows } = await db.query<{ postal_code: string | null }>(
      `select distinct b.postal_code
       from public.businesses b
       left join public.markets m on m.id = b.market_id
       where m.market_slug = 'boise-metro'
         and b.postal_code is not null
         and trim(b.postal_code) <> ''
       order by b.postal_code`,
    );

    uniqueZips = [
      ...new Set(
        rows
          .map((r) => normalizeZipCode(r.postal_code))
          .filter((z): z is string => Boolean(z)),
      ),
    ].sort();

    if (uniqueZips.length === 0) {
      // Fallback: qualified Boise Metro roofing with postal codes
      const { rows: fallback } = await db.query<{ postal_code: string | null }>(
        `select distinct b.postal_code
         from public.businesses b
         left join public.markets m on m.id = b.market_id
         where m.market_slug = 'boise-metro'
           and b.qualification_status = 'qualified'
           and b.target_sector = 'roofing'
           and b.postal_code is not null
           and trim(b.postal_code) <> ''`,
      );
      uniqueZips = [
        ...new Set(
          fallback
            .map((r) => normalizeZipCode(r.postal_code))
            .filter((z): z is string => Boolean(z)),
        ),
      ].sort();
    }
  } finally {
    // keep connection for upserts
  }

  console.log(
    JSON.stringify(
      {
        market: "boise-metro",
        uniqueBusinessZipCodes: uniqueZips.length,
        zipCodes: uniqueZips,
        usingCensusApiKey: Boolean(apiKey),
      },
      null,
      2,
    ),
  );

  if (uniqueZips.length === 0) {
    console.log("No ZIP codes found — nothing to fetch.");
    await db.end();
    return;
  }

  const { matched, unavailable, errors } = await fetchCensusZctaStats({
    zipCodes: uniqueZips,
    apiKey,
  });

  let upserted = 0;
  for (const row of matched) {
    await db.query(
      `insert into public.zip_code_stats (
        zip_code,
        population,
        households,
        housing_units,
        owner_occupied_housing_units,
        median_household_income,
        median_home_value,
        median_year_structure_built,
        owner_occupied_rate,
        data_source,
        dataset_year,
        dataset_name,
        retrieved_at,
        raw_response
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, now(), $13::jsonb
      )
      on conflict (zip_code) do update set
        population = excluded.population,
        households = excluded.households,
        housing_units = excluded.housing_units,
        owner_occupied_housing_units = excluded.owner_occupied_housing_units,
        median_household_income = excluded.median_household_income,
        median_home_value = excluded.median_home_value,
        median_year_structure_built = excluded.median_year_structure_built,
        owner_occupied_rate = excluded.owner_occupied_rate,
        data_source = excluded.data_source,
        dataset_year = excluded.dataset_year,
        dataset_name = excluded.dataset_name,
        retrieved_at = excluded.retrieved_at,
        raw_response = excluded.raw_response`,
      [
        row.zipCode,
        row.population,
        row.households,
        row.housingUnits,
        row.ownerOccupiedHousingUnits,
        row.medianHouseholdIncome,
        row.medianHomeValue,
        row.medianYearStructureBuilt,
        row.ownerOccupiedRate,
        CENSUS_DATA_SOURCE,
        CENSUS_DATASET_YEAR,
        CENSUS_DATASET_NAME,
        JSON.stringify(row.rawResponse),
      ],
    );
    upserted += 1;
  }

  // Sample: Point Roofing ZIP
  const { rows: pointRows } = await db.query<{
    name: string;
    postal_code: string | null;
    zip_code: string | null;
    population: number | null;
    households: number | null;
    median_household_income: string | number | null;
    median_home_value: string | number | null;
    owner_occupied_rate: string | number | null;
    dataset_year: number | null;
  }>(
    `select
       b.name,
       b.postal_code,
       z.zip_code,
       z.population,
       z.households,
       z.median_household_income,
       z.median_home_value,
       z.owner_occupied_rate,
       z.dataset_year
     from public.businesses b
     left join public.zip_code_stats z
       on z.zip_code = left(regexp_replace(coalesce(b.postal_code, ''), '[^0-9]', '', 'g'), 5)
     where b.name ilike '%Point Roofing%'
     limit 3`,
  );

  await db.end();

  console.log(
    JSON.stringify(
      {
        uniqueBusinessZipCodes: uniqueZips.length,
        censusZctasMatched: matched.length,
        unmatchedZipCodes: unavailable,
        upserted,
        errors,
        pointRoofingSample: pointRows,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
