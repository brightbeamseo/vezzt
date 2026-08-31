/**
 * Phase IIIB — Compute LOA roofing competition metrics + demographic quality flags.
 * No Opportunity Score.
 *
 * Usage: npm run analyze:loa-gbp
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";

config({ path: ".env.local" });

const OUT_DIR = join(process.cwd(), "tmp", "loa-gbp-full");
const SEARCH_NOISE_MILES = 80; // filter extreme geographic noise for search stats

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function ratio(num: number | null, den: number): number | null {
  if (num == null) return null;
  if (den <= 0) return null; // explicit zero-denominator → null, not a giant number
  return num / den;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const db = await connectAdminPg();

  // --- Demographic quality flags ---
  const { rows: loas } = await db.query<{
    id: string;
    slug: string;
    display_name: string;
    state: string;
    place_name: string | null;
    place_population: number | null;
    population: number | null;
    zcta_count: number | null;
    households: number | null;
    owner_occupied_units: number | null;
    housing_units: number | null;
    owner_occupied_rate: number | null;
    median_household_income: number | null;
    median_home_value: number | null;
    population_growth: number | null;
    housing_growth: number | null;
    single_family_detached_units: number | null;
    single_family_share: number | null;
    zcta_codes: string[] | null;
    center_lat: number;
    center_lng: number;
    radius_miles: number;
    macro_market_id: string;
  }>(
    `select id, slug, display_name, state, place_name, place_population, population,
            zcta_count, households, owner_occupied_units, housing_units,
            owner_occupied_rate::float, median_household_income::float,
            median_home_value::float, population_growth::float, housing_growth::float,
            single_family_detached_units, single_family_share::float, zcta_codes,
            center_lat::float, center_lng::float, radius_miles::float, macro_market_id
     from local_opportunity_areas`,
  );

  for (const loa of loas) {
    const notes: string[] = [];
    let flag: "ok" | "review" | "incomplete" = "ok";

    if (!loa.zcta_count || loa.zcta_count <= 0) {
      flag = "incomplete";
      notes.push("zero ZCTAs");
    }
    if (loa.population == null || loa.population <= 0) {
      flag = "incomplete";
      notes.push("missing/zero population");
    }
    if (
      loa.place_population != null &&
      loa.place_population >= 20000 &&
      loa.population != null &&
      loa.population < loa.place_population * 0.55
    ) {
      flag = flag === "incomplete" ? "incomplete" : "review";
      notes.push(
        `aggregated pop ${loa.population} << place pop ${loa.place_population} (possible missing core ZCTAs)`,
      );
    }
    if (
      loa.place_population != null &&
      loa.place_population >= 40000 &&
      (loa.zcta_count ?? 0) > 0 &&
      (loa.zcta_count ?? 0) <= 3 &&
      loa.population != null &&
      loa.population < loa.place_population
    ) {
      flag = "incomplete";
      notes.push(
        `only ${loa.zcta_count} ZCTAs for place pop ${loa.place_population}`,
      );
    }
    if ((loa.zcta_count ?? 0) === 1 && (loa.population ?? 0) < 5000) {
      flag = flag === "incomplete" ? "incomplete" : "review";
      notes.push("single sparse ZCTA");
    }

    await db.query(
      `update local_opportunity_areas
       set demo_quality_flag = $2, demo_quality_notes = $3, updated_at = now()
       where id = $1`,
      [loa.id, flag, notes.length ? notes.join("; ") : null],
    );
  }

  // --- Competition metrics ---
  const exportRows: unknown[] = [];

  for (const loa of loas) {
    const { rows: runStats } = await db.query<{
      n: number;
      cost: number;
    }>(
      `select count(*)::int as n, coalesce(sum(usage_usd),0)::float as cost
       from loa_gbp_search_runs where loa_id = $1 and status = 'SUCCEEDED'`,
      [loa.id],
    );
    const pointsDone = runStats[0]?.n ?? 0;
    const cost = runStats[0]?.cost ?? 0;

    const { rows: sightAgg } = await db.query<{
      sightings: number;
      unique_places: number;
    }>(
      `select count(*)::int as sightings,
              count(distinct place_id)::int as unique_places
       from loa_gbp_sightings where loa_id = $1`,
      [loa.id],
    );

    // Unique places by qualify for this LOA
    const { rows: byQualify } = await db.query<{
      qualify_bucket: string;
      n: number;
    }>(
      `select b.qualify_bucket, count(distinct s.place_id)::int as n
       from loa_gbp_sightings s
       join loa_gbp_businesses b on b.place_id = s.place_id
       where s.loa_id = $1
       group by b.qualify_bucket`,
      [loa.id],
    );
    const qMap = Object.fromEntries(
      byQualify.map((r) => [r.qualify_bucket, r.n]),
    );

    const { rows: physical2 } = await db.query<{
      place_id: string;
      title: string | null;
      reviews_count: number | null;
      total_score: number | null;
      distance_miles: number | null;
      city: string | null;
      state: string | null;
      category_name: string | null;
      website: string | null;
    }>(
      `select b.place_id, b.title, b.reviews_count, b.total_score::float,
              min(s.distance_miles)::float as distance_miles,
              b.city, b.state, b.category_name, b.website
       from loa_gbp_sightings s
       join loa_gbp_businesses b on b.place_id = s.place_id
       where s.loa_id = $1
         and b.qualify_bucket = 'primary'
         and coalesce(s.in_radius, false) = true
         and coalesce(b.permanently_closed, false) = false
       group by b.place_id, b.title, b.reviews_count, b.total_score,
                b.city, b.state, b.category_name, b.website
       order by b.reviews_count desc nulls last`,
      [loa.id],
    );
    const reviews = physical2
      .map((p) => p.reviews_count)
      .filter((n): n is number => typeof n === "number");
    const ratings = physical2
      .map((p) =>
        p.total_score != null ? Number(p.total_score) : null,
      )
      .filter((n): n is number => n != null && Number.isFinite(n));

    const sortedByReviews = [...physical2].sort(
      (a, b) => (b.reviews_count ?? 0) - (a.reviews_count ?? 0),
    );
    const top5 = sortedByReviews.slice(0, 5);
    const top5Reviews = top5
      .map((p) => p.reviews_count)
      .filter((n): n is number => typeof n === "number");
    const top5Ratings = top5
      .map((p) => (p.total_score != null ? Number(p.total_score) : null))
      .filter((n): n is number => n != null && Number.isFinite(n));

    const countAtLeast = (n: number) =>
      physical2.filter((p) => (p.reviews_count ?? 0) >= n).length;

    const ownerHh = loa.owner_occupied_units;
    const primaryIn = physical2.length;
    const c50 = countAtLeast(50);
    const c100 = countAtLeast(100);
    const c250 = countAtLeast(250);
    const c500 = countAtLeast(500);
    const c1000 = countAtLeast(1000);

    const top10 = sortedByReviews.slice(0, 10).map((p, i) => ({
      rank: i + 1,
      placeId: p.place_id,
      title: p.title,
      reviews: p.reviews_count,
      rating: p.total_score,
      distanceMiles: p.distance_miles,
      city: p.city,
      state: p.state,
      website: p.website,
    }));

    // Search-surfaced primary (any distance, but filter extreme noise for stats)
    const { rows: searchPrimary } = await db.query<{
      place_id: string;
      points: number;
      best_rank: number | null;
      avg_rank: number | null;
      distance_miles: number | null;
    }>(
      `select b.place_id,
              count(distinct s.search_point)::int as points,
              min(s.rank_in_search)::int as best_rank,
              avg(s.rank_in_search)::float as avg_rank,
              min(s.distance_miles)::float as distance_miles
       from loa_gbp_sightings s
       join loa_gbp_businesses b on b.place_id = s.place_id
       where s.loa_id = $1
         and b.qualify_bucket = 'primary'
         and coalesce(b.permanently_closed, false) = false
       group by b.place_id`,
      [loa.id],
    );

    const searchFiltered = searchPrimary.filter(
      (p) =>
        p.distance_miles == null || p.distance_miles <= SEARCH_NOISE_MILES,
    );
    const searchOutside = searchFiltered.filter(
      (p) => p.distance_miles != null && p.distance_miles > 15,
    );

    const status =
      pointsDone >= 5
        ? "complete"
        : pointsDone > 0
          ? "partial"
          : "failed";

    const roofersPer100k =
      loa.population && loa.population > 0
        ? (primaryIn / loa.population) * 100000
        : null;
    const roofersPer10kOwner =
      ownerHh && ownerHh > 0 ? (primaryIn / ownerHh) * 10000 : null;

    await db.query(
      `insert into loa_roofing_competition (
        loa_id, gbp_discovery_status, search_points_complete, discovery_cost_usd,
        raw_sightings, unique_place_ids, primary_count, secondary_count, other_count,
        primary_in_radius, roofers_per_100k_pop, roofers_per_10k_owner_hh,
        reviews_median, reviews_avg, reviews_max,
        reviews_50_plus, reviews_100_plus, reviews_250_plus, reviews_500_plus, reviews_1000_plus,
        top5_reviews_avg, top5_reviews_median,
        owner_hh_per_roofer, owner_hh_per_50_plus, owner_hh_per_100_plus,
        owner_hh_per_250_plus, owner_hh_per_500_plus,
        avg_rating, median_rating, top5_avg_rating,
        search_primary_surfaced, search_primary_outside_radius, search_outside_share,
        top10_competitors, anomaly_notes, computed_at, updated_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34::jsonb,$35,now(),now()
      )
      on conflict (loa_id) do update set
        gbp_discovery_status = excluded.gbp_discovery_status,
        search_points_complete = excluded.search_points_complete,
        discovery_cost_usd = excluded.discovery_cost_usd,
        raw_sightings = excluded.raw_sightings,
        unique_place_ids = excluded.unique_place_ids,
        primary_count = excluded.primary_count,
        secondary_count = excluded.secondary_count,
        other_count = excluded.other_count,
        primary_in_radius = excluded.primary_in_radius,
        roofers_per_100k_pop = excluded.roofers_per_100k_pop,
        roofers_per_10k_owner_hh = excluded.roofers_per_10k_owner_hh,
        reviews_median = excluded.reviews_median,
        reviews_avg = excluded.reviews_avg,
        reviews_max = excluded.reviews_max,
        reviews_50_plus = excluded.reviews_50_plus,
        reviews_100_plus = excluded.reviews_100_plus,
        reviews_250_plus = excluded.reviews_250_plus,
        reviews_500_plus = excluded.reviews_500_plus,
        reviews_1000_plus = excluded.reviews_1000_plus,
        top5_reviews_avg = excluded.top5_reviews_avg,
        top5_reviews_median = excluded.top5_reviews_median,
        owner_hh_per_roofer = excluded.owner_hh_per_roofer,
        owner_hh_per_50_plus = excluded.owner_hh_per_50_plus,
        owner_hh_per_100_plus = excluded.owner_hh_per_100_plus,
        owner_hh_per_250_plus = excluded.owner_hh_per_250_plus,
        owner_hh_per_500_plus = excluded.owner_hh_per_500_plus,
        avg_rating = excluded.avg_rating,
        median_rating = excluded.median_rating,
        top5_avg_rating = excluded.top5_avg_rating,
        search_primary_surfaced = excluded.search_primary_surfaced,
        search_primary_outside_radius = excluded.search_primary_outside_radius,
        search_outside_share = excluded.search_outside_share,
        top10_competitors = excluded.top10_competitors,
        anomaly_notes = excluded.anomaly_notes,
        computed_at = now(),
        updated_at = now()`,
      [
        loa.id,
        status,
        pointsDone,
        cost,
        sightAgg[0]?.sightings ?? 0,
        sightAgg[0]?.unique_places ?? 0,
        qMap.primary ?? 0,
        qMap.secondary ?? 0,
        qMap.other ?? 0,
        primaryIn,
        roofersPer100k,
        roofersPer10kOwner,
        median(reviews),
        avg(reviews),
        reviews.length ? Math.max(...reviews) : null,
        c50,
        c100,
        c250,
        c500,
        c1000,
        avg(top5Reviews),
        median(top5Reviews),
        ratio(ownerHh, primaryIn),
        ratio(ownerHh, c50),
        ratio(ownerHh, c100),
        ratio(ownerHh, c250),
        ratio(ownerHh, c500),
        avg(ratings),
        median(ratings),
        avg(top5Ratings),
        searchFiltered.length,
        searchOutside.length,
        searchFiltered.length
          ? searchOutside.length / searchFiltered.length
          : null,
        JSON.stringify(top10),
        null,
      ],
    );

    // Fetch demo quality for export
    const { rows: dq } = await db.query<{
      demo_quality_flag: string | null;
      demo_quality_notes: string | null;
      macro_name: string;
    }>(
      `select l.demo_quality_flag, l.demo_quality_notes, m.market_name as macro_name
       from local_opportunity_areas l
       join markets m on m.id = l.macro_market_id
       where l.id = $1`,
      [loa.id],
    );

    exportRows.push({
      loa: loa.display_name,
      slug: loa.slug,
      state: loa.state,
      macroMarket: dq[0]?.macro_name,
      centerLat: loa.center_lat,
      centerLng: loa.center_lng,
      radiusMiles: loa.radius_miles,
      population: loa.population,
      populationGrowth: loa.population_growth,
      households: loa.households,
      ownerOccupiedHouseholds: loa.owner_occupied_units,
      homeownershipPct: loa.owner_occupied_rate,
      medianHouseholdIncome: loa.median_household_income,
      medianHomeValue: loa.median_home_value,
      housingUnits: loa.housing_units,
      housingGrowth: loa.housing_growth,
      singleFamilyUnits: loa.single_family_detached_units,
      singleFamilyShare: loa.single_family_share,
      primaryRoofersInRadius: primaryIn,
      roofersPer100kPop: roofersPer100k,
      roofersPer10kOwnerHh: roofersPer10kOwner,
      reviewsMedian: median(reviews),
      reviewsAvg: avg(reviews),
      reviewsMax: reviews.length ? Math.max(...reviews) : null,
      reviews50Plus: c50,
      reviews100Plus: c100,
      reviews250Plus: c250,
      reviews500Plus: c500,
      reviews1000Plus: c1000,
      top5ReviewsAvg: avg(top5Reviews),
      top5ReviewsMedian: median(top5Reviews),
      ownerHhPerRoofer: ratio(ownerHh, primaryIn),
      ownerHhPer50Plus: ratio(ownerHh, c50),
      ownerHhPer100Plus: ratio(ownerHh, c100),
      ownerHhPer250Plus: ratio(ownerHh, c250),
      ownerHhPer500Plus: ratio(ownerHh, c500),
      avgRating: avg(ratings),
      medianRating: median(ratings),
      top5AvgRating: avg(top5Ratings),
      searchPrimarySurfaced: searchFiltered.length,
      searchPrimaryOutsideRadius: searchOutside.length,
      demoQualityFlag: dq[0]?.demo_quality_flag,
      demoQualityNotes: dq[0]?.demo_quality_notes,
      gbpDiscoveryStatus: status,
      discoveryCostUsd: cost,
      top10Competitors: top10,
    });
  }

  writeFileSync(
    join(OUT_DIR, "loa-competition-export.json"),
    JSON.stringify(exportRows, null, 2),
  );

  // CSV (flat, without top10)
  const flatKeys = Object.keys(exportRows[0] as object).filter(
    (k) => k !== "top10Competitors",
  );
  const csvEscape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    flatKeys.join(","),
    ...exportRows.map((row) =>
      flatKeys
        .map((k) => csvEscape((row as Record<string, unknown>)[k]))
        .join(","),
    ),
  ].join("\n");
  writeFileSync(join(OUT_DIR, "loa-competition-export.csv"), csv);

  // Global summary
  const { rows: summary } = await db.query(`
    select
      (select count(*) from local_opportunity_areas) as loas,
      (select count(*) from loa_gbp_search_runs where status='SUCCEEDED') as runs_ok,
      (select coalesce(sum(usage_usd),0) from loa_gbp_search_runs) as apify_cost,
      (select count(*) from loa_gbp_sightings) as raw_sightings,
      (select count(*) from loa_gbp_businesses) as unique_place_ids,
      (select count(*) from loa_gbp_businesses where qualify_bucket='primary') as primary_global,
      (select count(*) from loa_gbp_businesses where qualify_bucket='secondary') as secondary_global,
      (select count(*) from loa_gbp_businesses where qualify_bucket='other') as other_global,
      (select count(*) from local_opportunity_areas where demo_quality_flag='incomplete') as demo_incomplete,
      (select count(*) from local_opportunity_areas where demo_quality_flag='review') as demo_review
  `);

  const { rows: inRadiusMemberships } = await db.query(`
    select count(*)::int as n from (
      select distinct s.loa_id, s.place_id
      from loa_gbp_sightings s
      join loa_gbp_businesses b on b.place_id = s.place_id
      where b.qualify_bucket = 'primary'
        and coalesce(s.in_radius,false) = true
        and coalesce(b.permanently_closed,false) = false
    ) t
  `);

  const report = {
    summary: {
      ...summary[0],
      inRadiusPrimaryMemberships: inRadiusMemberships[0]?.n,
    },
    incompleteDemoLoas: loas
      .filter(() => true)
      .map((l) => l.slug),
  };

  // Refresh incomplete list from DB
  const { rows: badDemo } = await db.query(
    `select display_name, state, population, place_population, zcta_count, demo_quality_flag, demo_quality_notes
     from local_opportunity_areas
     where demo_quality_flag in ('incomplete','review')
     order by demo_quality_flag, population nulls first`,
  );
  writeFileSync(
    join(OUT_DIR, "analysis-summary.json"),
    JSON.stringify({ summary: report.summary, demoQualityIssues: badDemo }, null, 2),
  );

  console.log(JSON.stringify({ summary: report.summary, demoQualityIssues: badDemo }, null, 2));
  console.log(`\nWrote ${OUT_DIR}/loa-competition-export.csv`);
  await db.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
