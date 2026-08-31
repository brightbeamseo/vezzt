/**
 * Phase IV — Clean analytical dataset + distributions, correlations,
 * eligibility floors, diagnostic leaderboards, candidates, overlap,
 * and primary-vs-secondary sensitivity. No Opportunity Score.
 *
 * Usage: npm run analyze:phase4
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { createAdminPgPool } from "../src/lib/admin-db";
import { distanceMiles } from "../src/lib/local-opportunity-areas";

config({ path: ".env.local" });

const OUT = join(process.cwd(), "tmp", "phase4");

type Row = {
  id: string;
  slug: string;
  loa: string;
  state: string;
  macroMarket: string;
  centerLat: number;
  centerLng: number;
  radiusMiles: number;
  population: number | null;
  populationGrowth: number | null;
  households: number | null;
  householdGrowth: number | null;
  ownerOccupiedHouseholds: number | null;
  homeownershipPct: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  housingUnits: number | null;
  housingGrowth: number | null;
  singleFamilyUnits: number | null;
  singleFamilyShare: number | null;
  primaryInRadius: number;
  secondaryInRadius: number;
  primaryPlusSecondaryInRadius: number;
  roofersPer100kPop: number | null;
  roofersPer10kOwnerHh: number | null;
  ownerHhPerPrimary: number | null;
  reviewsMedian: number | null;
  reviewsAvg: number | null;
  reviewsMax: number | null;
  reviews50: number;
  reviews100: number;
  reviews250: number;
  reviews500: number;
  reviews1000: number;
  top5ReviewsAvg: number | null;
  top5ReviewsMedian: number | null;
  ownerHhPer50: number | null;
  ownerHhPer100: number | null;
  ownerHhPer250: number | null;
  ownerHhPer500: number | null;
  avgRating: number | null;
  medianRating: number | null;
  demoQualityFlag: string | null;
  demoCorrected: boolean;
  demoCorrectionMethod: string | null;
  zctaCodes: string[];
  validForRanking: boolean;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function ratio(numv: number | null, den: number): number | null {
  if (numv == null) return null;
  if (den <= 0) return null;
  return numv / den;
}

function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const a = sorted[base]!;
  const b = sorted[Math.min(base + 1, sorted.length - 1)]!;
  return a + rest * (b - a);
}

function distStats(values: Array<number | null>) {
  const v = values
    .filter((x): x is number => x != null && Number.isFinite(x))
    .sort((a, b) => a - b);
  if (!v.length) {
    return {
      n: 0,
      min: null,
      p10: null,
      p25: null,
      median: null,
      p75: null,
      p90: null,
      max: null,
    };
  }
  return {
    n: v.length,
    min: v[0]!,
    p10: quantile(v, 0.1),
    p25: quantile(v, 0.25),
    median: quantile(v, 0.5),
    p75: quantile(v, 0.75),
    p90: quantile(v, 0.9),
    max: v[v.length - 1]!,
  };
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 5) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const numv = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den === 0) return null;
  return numv / den;
}

function paired(
  rows: Row[],
  a: keyof Row,
  b: keyof Row,
): { xs: number[]; ys: number[] } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const r of rows) {
    const av = r[a];
    const bv = r[b];
    if (typeof av === "number" && typeof bv === "number") {
      xs.push(av);
      ys.push(bv);
    }
  }
  return { xs, ys };
}

function topN(
  rows: Row[],
  key: keyof Row,
  n: number,
  dir: "desc" | "asc" = "desc",
) {
  return [...rows]
    .filter((r) => typeof r[key] === "number")
    .sort((a, b) => {
      const av = a[key] as number;
      const bv = b[key] as number;
      return dir === "desc" ? bv - av : av - bv;
    })
    .slice(0, n)
    .map((r, i) => ({
      rank: i + 1,
      loa: r.loa,
      state: r.state,
      macroMarket: r.macroMarket,
      value: r[key],
      ownerHh: r.ownerOccupiedHouseholds,
      population: r.population,
      primary: r.primaryInRadius,
      reviews100: r.reviews100,
      mhi: r.medianHouseholdIncome,
      popGrowth: r.populationGrowth,
    }));
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return csvEscape(v.join("|"));
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pool = createAdminPgPool(4);

  // Recompute competition metrics with corrected demographics (owner HH ratios)
  // by joining current LOA demos + competition physical counts from sightings.
  const { rows: raw } = await pool.query(`
    select
      l.id, l.slug, l.display_name, l.state,
      m.market_name as macro_market,
      l.center_lat::float, l.center_lng::float, l.radius_miles::float,
      l.population, l.population_growth::float,
      l.households, l.household_growth::float,
      l.owner_occupied_units, l.owner_occupied_rate::float,
      l.median_household_income::float, l.median_home_value::float,
      l.housing_units, l.housing_growth::float,
      l.single_family_detached_units, l.single_family_share::float,
      l.demo_quality_flag, l.demo_corrected, l.demo_correction_method,
      l.zcta_codes,
      c.avg_rating::float, c.median_rating::float,
      c.top10_competitors
    from local_opportunity_areas l
    join markets m on m.id = l.macro_market_id
    left join loa_roofing_competition c on c.loa_id = l.id
    order by l.population desc nulls last
  `);

  const dataset: Row[] = [];

  for (const r of raw) {
    const loaId = r.id as string;
    const ownerHh = (r.owner_occupied_units as number | null) ?? null;
    const pop = (r.population as number | null) ?? null;

    const { rows: primaryRows } = await pool.query<{
      place_id: string;
      reviews_count: number | null;
      total_score: number | null;
    }>(
      `select b.place_id, b.reviews_count, b.total_score::float
       from loa_gbp_sightings s
       join loa_gbp_businesses b on b.place_id = s.place_id
       where s.loa_id = $1
         and b.qualify_bucket = 'primary'
         and coalesce(s.in_radius,false) = true
         and coalesce(b.permanently_closed,false) = false
       group by b.place_id, b.reviews_count, b.total_score`,
      [loaId],
    );

    const { rows: secondaryRows } = await pool.query<{ place_id: string }>(
      `select b.place_id
       from loa_gbp_sightings s
       join loa_gbp_businesses b on b.place_id = s.place_id
       where s.loa_id = $1
         and b.qualify_bucket = 'secondary'
         and coalesce(s.in_radius,false) = true
         and coalesce(b.permanently_closed,false) = false
       group by b.place_id`,
      [loaId],
    );

    const reviews = primaryRows
      .map((p) => p.reviews_count)
      .filter((n): n is number => typeof n === "number");
    const sorted = [...primaryRows].sort(
      (a, b) => (b.reviews_count ?? 0) - (a.reviews_count ?? 0),
    );
    const top5 = sorted.slice(0, 5);
    const top5Reviews = top5
      .map((p) => p.reviews_count)
      .filter((n): n is number => typeof n === "number");
    const ratings = primaryRows
      .map((p) => num(p.total_score))
      .filter((n): n is number => n != null);

    const countAt = (n: number) =>
      primaryRows.filter((p) => (p.reviews_count ?? 0) >= n).length;

    const primary = primaryRows.length;
    const secondary = secondaryRows.length;
    const c50 = countAt(50);
    const c100 = countAt(100);
    const c250 = countAt(250);
    const c500 = countAt(500);
    const c1000 = countAt(1000);

    const flag = (r.demo_quality_flag as string | null) ?? null;
    const validForRanking =
      (flag === "ok" || flag === "corrected") &&
      pop != null &&
      pop > 0 &&
      ownerHh != null;

    const med = distStats(reviews).median;
    const avg =
      reviews.length > 0
        ? reviews.reduce((a, b) => a + b, 0) / reviews.length
        : null;

    dataset.push({
      id: loaId,
      slug: r.slug as string,
      loa: r.display_name as string,
      state: r.state as string,
      macroMarket: r.macro_market as string,
      centerLat: Number(r.center_lat),
      centerLng: Number(r.center_lng),
      radiusMiles: Number(r.radius_miles),
      population: pop,
      populationGrowth: num(r.population_growth),
      households: (r.households as number | null) ?? null,
      householdGrowth: num(r.household_growth),
      ownerOccupiedHouseholds: ownerHh,
      homeownershipPct: num(r.owner_occupied_rate),
      medianHouseholdIncome: num(r.median_household_income),
      medianHomeValue: num(r.median_home_value),
      housingUnits: (r.housing_units as number | null) ?? null,
      housingGrowth: num(r.housing_growth),
      singleFamilyUnits: (r.single_family_detached_units as number | null) ?? null,
      singleFamilyShare: num(r.single_family_share),
      primaryInRadius: primary,
      secondaryInRadius: secondary,
      primaryPlusSecondaryInRadius: primary + secondary,
      roofersPer100kPop:
        pop && pop > 0 ? (primary / pop) * 100000 : null,
      roofersPer10kOwnerHh:
        ownerHh && ownerHh > 0 ? (primary / ownerHh) * 10000 : null,
      ownerHhPerPrimary: ratio(ownerHh, primary),
      reviewsMedian: med,
      reviewsAvg: avg,
      reviewsMax: reviews.length ? Math.max(...reviews) : null,
      reviews50: c50,
      reviews100: c100,
      reviews250: c250,
      reviews500: c500,
      reviews1000: c1000,
      top5ReviewsAvg:
        top5Reviews.length > 0
          ? top5Reviews.reduce((a, b) => a + b, 0) / top5Reviews.length
          : null,
      top5ReviewsMedian: distStats(top5Reviews).median,
      ownerHhPer50: ratio(ownerHh, c50),
      ownerHhPer100: ratio(ownerHh, c100),
      ownerHhPer250: ratio(ownerHh, c250),
      ownerHhPer500: ratio(ownerHh, c500),
      avgRating:
        ratings.length > 0
          ? ratings.reduce((a, b) => a + b, 0) / ratings.length
          : num(r.avg_rating),
      medianRating: distStats(ratings).median ?? num(r.median_rating),
      demoQualityFlag: flag,
      demoCorrected: Boolean(r.demo_corrected),
      demoCorrectionMethod: (r.demo_correction_method as string | null) ?? null,
      zctaCodes: Array.isArray(r.zcta_codes) ? (r.zcta_codes as string[]) : [],
      validForRanking,
    });

    // Refresh competition table owner-HH ratios with corrected demos
    await pool.query(
      `update loa_roofing_competition set
        primary_in_radius = $2,
        roofers_per_100k_pop = $3,
        roofers_per_10k_owner_hh = $4,
        reviews_median = $5,
        reviews_avg = $6,
        reviews_max = $7,
        reviews_50_plus = $8,
        reviews_100_plus = $9,
        reviews_250_plus = $10,
        reviews_500_plus = $11,
        reviews_1000_plus = $12,
        top5_reviews_avg = $13,
        top5_reviews_median = $14,
        owner_hh_per_roofer = $15,
        owner_hh_per_50_plus = $16,
        owner_hh_per_100_plus = $17,
        owner_hh_per_250_plus = $18,
        owner_hh_per_500_plus = $19,
        avg_rating = $20,
        median_rating = $21,
        computed_at = now(),
        updated_at = now()
      where loa_id = $1`,
      [
        loaId,
        primary,
        pop && pop > 0 ? (primary / pop) * 100000 : null,
        ownerHh && ownerHh > 0 ? (primary / ownerHh) * 10000 : null,
        med,
        avg,
        reviews.length ? Math.max(...reviews) : null,
        c50,
        c100,
        c250,
        c500,
        c1000,
        top5Reviews.length
          ? top5Reviews.reduce((a, b) => a + b, 0) / top5Reviews.length
          : null,
        distStats(top5Reviews).median,
        ratio(ownerHh, primary),
        ratio(ownerHh, c50),
        ratio(ownerHh, c100),
        ratio(ownerHh, c250),
        ratio(ownerHh, c500),
        ratings.length
          ? ratings.reduce((a, b) => a + b, 0) / ratings.length
          : null,
        distStats(ratings).median,
      ],
    );
  }

  const valid = dataset.filter((r) => r.validForRanking);
  console.log(
    `Dataset: ${dataset.length} LOAs, valid for ranking analysis: ${valid.length}`,
  );

  // --- Distributions ---
  const distKeys: Array<{ key: keyof Row; label: string }> = [
    { key: "ownerOccupiedHouseholds", label: "owner_occupied_households" },
    { key: "singleFamilyUnits", label: "single_family_units" },
    { key: "medianHouseholdIncome", label: "median_household_income" },
    { key: "medianHomeValue", label: "median_home_value" },
    { key: "populationGrowth", label: "population_growth_pct" },
    { key: "housingGrowth", label: "housing_growth_pct" },
    { key: "population", label: "population" },
    { key: "primaryInRadius", label: "primary_roofers_in_radius" },
    { key: "ownerHhPerPrimary", label: "owner_hh_per_primary" },
    { key: "ownerHhPer100", label: "owner_hh_per_100_plus" },
    { key: "ownerHhPer250", label: "owner_hh_per_250_plus" },
    { key: "ownerHhPer500", label: "owner_hh_per_500_plus" },
    { key: "reviewsMedian", label: "median_reviews" },
    { key: "top5ReviewsAvg", label: "top5_avg_reviews" },
    { key: "reviews100", label: "count_100_plus" },
    { key: "reviews250", label: "count_250_plus" },
  ];

  const distributions: Record<string, ReturnType<typeof distStats>> = {};
  for (const d of distKeys) {
    distributions[d.label] = distStats(valid.map((r) => num(r[d.key])));
  }

  // --- Correlations ---
  const corrPairs: Array<[keyof Row, keyof Row, string]> = [
    ["population", "households", "population_vs_households"],
    ["households", "ownerOccupiedHouseholds", "households_vs_owner_hh"],
    ["ownerOccupiedHouseholds", "singleFamilyUnits", "owner_hh_vs_sf_units"],
    ["medianHouseholdIncome", "medianHomeValue", "income_vs_home_value"],
    ["primaryInRadius", "roofersPer10kOwnerHh", "primary_count_vs_density"],
    ["primaryInRadius", "ownerHhPerPrimary", "primary_count_vs_owner_hh_per"],
    ["reviews100", "reviews250", "count_100_vs_250"],
    ["reviews250", "reviews500", "count_250_vs_500"],
    ["reviewsMedian", "top5ReviewsAvg", "median_reviews_vs_top5_avg"],
    ["ownerHhPer100", "ownerHhPer250", "owner_hh_per_100_vs_250"],
    ["ownerHhPer250", "ownerHhPer500", "owner_hh_per_250_vs_500"],
    ["ownerHhPerPrimary", "ownerHhPer100", "owner_hh_per_primary_vs_100"],
    ["populationGrowth", "housingGrowth", "pop_growth_vs_housing_growth"],
    ["ownerOccupiedHouseholds", "medianHouseholdIncome", "owner_hh_vs_income"],
    ["primaryInRadius", "reviews100", "primary_count_vs_100_plus"],
  ];

  const correlations = corrPairs.map(([a, b, label]) => {
    const { xs, ys } = paired(valid, a, b);
    const r = pearson(xs, ys);
    return {
      pair: label,
      a,
      b,
      n: xs.length,
      r: r != null ? Number(r.toFixed(3)) : null,
      redundant: r != null && Math.abs(r) >= 0.85,
      highlyRelated: r != null && Math.abs(r) >= 0.7 && Math.abs(r) < 0.85,
    };
  });

  // --- Eligibility floors ---
  const ownerFloors = [10000, 20000, 30000, 50000];
  const popFloors = [25000, 50000, 100000];
  const eligibility = {
    ownerOccupiedHouseholds: ownerFloors.map((floor) => {
      const keep = valid.filter(
        (r) => (r.ownerOccupiedHouseholds ?? 0) >= floor,
      );
      const drop = valid.filter(
        (r) => (r.ownerOccupiedHouseholds ?? 0) < floor,
      );
      return {
        floor,
        remaining: keep.length,
        excluded: drop.length,
        notableExcluded: drop
          .sort(
            (a, b) =>
              (b.ownerOccupiedHouseholds ?? 0) -
              (a.ownerOccupiedHouseholds ?? 0),
          )
          .slice(0, 12)
          .map((r) => ({
            loa: r.loa,
            state: r.state,
            ownerHh: r.ownerOccupiedHouseholds,
            population: r.population,
          })),
      };
    }),
    population: popFloors.map((floor) => {
      const keep = valid.filter((r) => (r.population ?? 0) >= floor);
      const drop = valid.filter((r) => (r.population ?? 0) < floor);
      return {
        floor,
        remaining: keep.length,
        excluded: drop.length,
        notableExcluded: drop
          .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
          .slice(0, 12)
          .map((r) => ({
            loa: r.loa,
            state: r.state,
            population: r.population,
            ownerHh: r.ownerOccupiedHouseholds,
          })),
      };
    }),
  };

  // --- Diagnostic leaderboards ---
  const economicsScore = (r: Row) => {
    // descriptive only — average of income and home-value z-ish ranks via values
    return (r.medianHouseholdIncome ?? 0) / 1000 + (r.medianHomeValue ?? 0) / 10000;
  };
  const economicsBoard = [...valid]
    .map((r) => ({ r, score: economicsScore(r) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20)
    .map((x, i) => ({
      rank: i + 1,
      loa: x.r.loa,
      state: x.r.state,
      mhi: x.r.medianHouseholdIncome,
      homeValue: x.r.medianHomeValue,
      ownerHh: x.r.ownerOccupiedHouseholds,
      population: x.r.population,
    }));

  const leaderboards = {
    largestHomeownerOpportunity: topN(valid, "ownerOccupiedHouseholds", 20),
    strongestHouseholdEconomics: economicsBoard,
    highestGrowth: [...valid]
      .filter((r) => r.populationGrowth != null)
      .sort((a, b) => (b.populationGrowth ?? 0) - (a.populationGrowth ?? 0))
      .slice(0, 20)
      .map((r, i) => ({
        rank: i + 1,
        loa: r.loa,
        state: r.state,
        populationGrowth: r.populationGrowth,
        housingGrowth: r.housingGrowth,
        population: r.population,
        ownerHh: r.ownerOccupiedHouseholds,
      })),
    lowestCompetitorDensity: topN(valid, "ownerHhPerPrimary", 20),
    lowestEstablishedDensity100: topN(valid, "ownerHhPer100", 20),
    lowestStrongIncumbent250: topN(valid, "ownerHhPer250", 20),
    lowestStrongIncumbent500: topN(valid, "ownerHhPer500", 20),
    strongestIncumbentMarkets: topN(valid, "top5ReviewsAvg", 20),
  };

  // --- Cross-dimension candidates ---
  const medOwner = distributions.owner_occupied_households.median ?? 0;
  const medIncome = distributions.median_household_income.median ?? 0;
  const medPerPrimary = distributions.owner_hh_per_primary.median ?? 0;
  const medPer100 = distributions.owner_hh_per_100_plus.median ?? 0;
  const p75Owner = distributions.owner_occupied_households.p75 ?? 0;
  const p75Income = distributions.median_household_income.p75 ?? 0;
  const p75PerPrimary = distributions.owner_hh_per_primary.p75 ?? 0;
  const p75Per100 = distributions.owner_hh_per_100_plus.p75 ?? 0;

  const medianCandidates = valid.filter(
    (r) =>
      (r.ownerOccupiedHouseholds ?? 0) >= medOwner &&
      (r.medianHouseholdIncome ?? 0) >= medIncome &&
      ((r.ownerHhPerPrimary ?? 0) >= medPerPrimary ||
        (r.ownerHhPer100 ?? 0) >= medPer100),
  );

  const p75Candidates = valid.filter(
    (r) =>
      (r.ownerOccupiedHouseholds ?? 0) >= p75Owner &&
      (r.medianHouseholdIncome ?? 0) >= p75Income &&
      ((r.ownerHhPerPrimary ?? 0) >= p75PerPrimary ||
        (r.ownerHhPer100 ?? 0) >= p75Per100),
  );

  const candidateList = medianCandidates
    .map((r) => ({
      loa: r.loa,
      state: r.state,
      macroMarket: r.macroMarket,
      ownerHh: r.ownerOccupiedHouseholds,
      mhi: r.medianHouseholdIncome,
      popGrowth: r.populationGrowth,
      primary: r.primaryInRadius,
      ownerHhPerPrimary: r.ownerHhPerPrimary,
      ownerHhPer100: r.ownerHhPer100,
      reviews100: r.reviews100,
      top5Avg: r.top5ReviewsAvg,
      passesP75:
        (r.ownerOccupiedHouseholds ?? 0) >= p75Owner &&
        (r.medianHouseholdIncome ?? 0) >= p75Income &&
        ((r.ownerHhPerPrimary ?? 0) >= p75PerPrimary ||
          (r.ownerHhPer100 ?? 0) >= p75Per100),
      id: r.id,
      centerLat: r.centerLat,
      centerLng: r.centerLng,
      zctaCodes: r.zctaCodes,
    }))
    .sort(
      (a, b) =>
        Number(b.passesP75) - Number(a.passesP75) ||
        (b.ownerHhPer100 ?? 0) - (a.ownerHhPer100 ?? 0),
    );

  // --- Overlap among candidates ---
  const overlaps: unknown[] = [];
  for (let i = 0; i < candidateList.length; i++) {
    for (let j = i + 1; j < candidateList.length; j++) {
      const a = candidateList[i]!;
      const b = candidateList[j]!;
      const dist = distanceMiles(
        { lat: a.centerLat, lng: a.centerLng },
        { lat: b.centerLat, lng: b.centerLng },
      );
      if (dist > 25) continue;
      const setA = new Set(a.zctaCodes);
      const setB = new Set(b.zctaCodes);
      const shared = [...setA].filter((z) => setB.has(z));
      const union = new Set([...setA, ...setB]);
      const sharedPct =
        union.size > 0 ? shared.length / union.size : 0;
      if (dist <= 20 || sharedPct >= 0.25 || a.macroMarket === b.macroMarket) {
        overlaps.push({
          a: a.loa,
          b: b.loa,
          stateA: a.state,
          stateB: b.state,
          sameMacro: a.macroMarket === b.macroMarket,
          macroMarket: a.macroMarket,
          distanceMiles: Number(dist.toFixed(1)),
          sharedZctas: shared.length,
          sharedZctaPct: Number(sharedPct.toFixed(3)),
          substantial:
            dist <= 12 || sharedPct >= 0.35 || (dist <= 18 && sharedPct >= 0.2),
        });
      }
    }
  }
  (overlaps as Array<{ substantial: boolean; distanceMiles: number }>).sort(
    (a, b) =>
      Number(b.substantial) - Number(a.substantial) ||
      a.distanceMiles - b.distanceMiles,
  );

  // --- Secondary sensitivity ---
  const secondarySensitivity = valid
    .map((r) => {
      const base = r.primaryInRadius;
      const expanded = r.primaryPlusSecondaryInRadius;
      const delta = expanded - base;
      const pct = base > 0 ? (delta / base) * 100 : delta > 0 ? 100 : 0;
      const ownerBase = r.ownerHhPerPrimary;
      const ownerExp = ratio(r.ownerOccupiedHouseholds, expanded);
      return {
        loa: r.loa,
        state: r.state,
        primary: base,
        secondary: r.secondaryInRadius,
        expanded,
        delta,
        pctChange: Number(pct.toFixed(1)),
        ownerHhPerPrimary: ownerBase,
        ownerHhPerExpanded: ownerExp,
        ownerHhPerChange:
          ownerBase != null && ownerExp != null
            ? Number((ownerExp - ownerBase).toFixed(1))
            : null,
      };
    })
    .sort((a, b) => Math.abs(b.pctChange) - Math.abs(a.pctChange));

  const materialSecondary = secondarySensitivity.filter(
    (s) => s.pctChange >= 20 || (s.delta >= 5 && s.pctChange >= 10),
  );

  // --- Metric assessment ---
  const metricAssessment = {
    distinctSignals: [
      "owner_occupied_households (market size / demand base)",
      "median_household_income or median_home_value (economics — pick one primary, other contextual)",
      "population_growth or housing_growth (growth — highly related; pick one)",
      "owner_hh_per_primary (quantity scarcity)",
      "owner_hh_per_100_plus or owner_hh_per_250_plus (established scarcity — related but not identical)",
      "top5_avg_reviews (incumbent strength landscape)",
    ],
    redundant: correlations
      .filter((c) => c.redundant)
      .map((c) => `${c.pair} (r=${c.r})`),
    highlyRelated: correlations
      .filter((c) => c.highlyRelated)
      .map((c) => `${c.pair} (r=${c.r})`),
    secondaryContextual: [
      "ratings (avg/median) — preserve but do not weight heavily yet",
      "roofers_per_100k_pop — largely inverse of owner_hh_per when tenure stable",
      "raw primary count — useful context but size-confounded vs ratios",
    ],
  };

  const report = {
    summary: {
      totalLoas: dataset.length,
      validForRankingAnalysis: valid.length,
      correctedDemographics: dataset.filter((r) => r.demoCorrected).length,
      excludedIncompleteOrReview: dataset.filter((r) => !r.validForRanking)
        .length,
      excludedLoas: dataset
        .filter((r) => !r.validForRanking)
        .map((r) => ({
          loa: r.loa,
          state: r.state,
          flag: r.demoQualityFlag,
        })),
      thresholdsUsed: {
        medianOwnerHh: medOwner,
        medianIncome: medIncome,
        medianOwnerHhPerPrimary: medPerPrimary,
        medianOwnerHhPer100: medPer100,
        p75OwnerHh: p75Owner,
        p75Income: p75Income,
        p75OwnerHhPerPrimary: p75PerPrimary,
        p75OwnerHhPer100: p75Per100,
      },
      candidateCountMedianRules: medianCandidates.length,
      candidateCountP75Rules: p75Candidates.length,
      materialSecondarySensitivityCount: materialSecondary.length,
    },
    corrections: dataset
      .filter((r) => r.demoCorrected)
      .map((r) => ({
        loa: r.loa,
        state: r.state,
        method: r.demoCorrectionMethod,
        population: r.population,
        ownerHh: r.ownerOccupiedHouseholds,
        zctaCount: r.zctaCodes.length,
      })),
    distributions,
    correlations,
    eligibility,
    leaderboards,
    candidatesForFurtherAnalysis: candidateList,
    candidateOverlaps: overlaps,
    secondarySensitivity: {
      materialLoas: materialSecondary.slice(0, 40),
      summary: {
        medianPctChange: distStats(
          secondarySensitivity.map((s) => s.pctChange),
        ).median,
        p90PctChange: distStats(secondarySensitivity.map((s) => s.pctChange))
          .p90,
        loasWithGe20PctIncrease: secondarySensitivity.filter(
          (s) => s.pctChange >= 20,
        ).length,
      },
    },
    metricAssessment,
  };

  writeFileSync(join(OUT, "phase4-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(OUT, "clean-analysis-dataset.json"),
    JSON.stringify(dataset, null, 2),
  );

  const flatKeys = [
    "loa",
    "state",
    "macroMarket",
    "centerLat",
    "centerLng",
    "radiusMiles",
    "population",
    "populationGrowth",
    "households",
    "householdGrowth",
    "ownerOccupiedHouseholds",
    "homeownershipPct",
    "medianHouseholdIncome",
    "medianHomeValue",
    "housingUnits",
    "housingGrowth",
    "singleFamilyUnits",
    "singleFamilyShare",
    "primaryInRadius",
    "secondaryInRadius",
    "primaryPlusSecondaryInRadius",
    "roofersPer100kPop",
    "roofersPer10kOwnerHh",
    "ownerHhPerPrimary",
    "reviewsMedian",
    "reviewsAvg",
    "reviewsMax",
    "reviews50",
    "reviews100",
    "reviews250",
    "reviews500",
    "reviews1000",
    "top5ReviewsAvg",
    "top5ReviewsMedian",
    "ownerHhPer50",
    "ownerHhPer100",
    "ownerHhPer250",
    "ownerHhPer500",
    "avgRating",
    "medianRating",
    "demoQualityFlag",
    "demoCorrected",
    "demoCorrectionMethod",
    "validForRanking",
  ] as const;

  const csv = [
    flatKeys.join(","),
    ...dataset.map((row) =>
      flatKeys.map((k) => csvEscape(row[k])).join(","),
    ),
  ].join("\n");
  writeFileSync(join(OUT, "clean-analysis-dataset.csv"), csv);

  const validCsv = [
    flatKeys.join(","),
    ...valid.map((row) => flatKeys.map((k) => csvEscape(row[k])).join(",")),
  ].join("\n");
  writeFileSync(join(OUT, "clean-analysis-dataset-valid-only.csv"), validCsv);

  console.log(JSON.stringify(report.summary, null, 2));
  console.log("\nRedundant correlations:");
  console.log(report.metricAssessment.redundant);
  console.log("\nCandidates (median rules):", candidateList.length);
  console.log("P75 candidates:", p75Candidates.length);
  console.log(`\nWrote ${OUT}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
