/**
 * Phase V — Roofing Expansion Opportunity Score (0–100).
 *
 * Eligibility: owner HH ≥ 10,000 + acceptable demographics.
 * Percentile-normalized components; three weight models for sensitivity.
 *
 * Usage: npm run score:opportunity
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { createAdminPgPool } from "../src/lib/admin-db";
import { distanceMiles } from "../src/lib/local-opportunity-areas";

config({ path: ".env.local" });

const OUT = join(process.cwd(), "tmp", "phase5");
const PHASE4 = join(process.cwd(), "tmp", "phase4");
const OWNER_HH_FLOOR = 10000;

type Phase4Row = {
  id: string;
  slug: string;
  loa: string;
  state: string;
  macroMarket: string;
  centerLat: number;
  centerLng: number;
  population: number | null;
  populationGrowth: number | null;
  ownerOccupiedHouseholds: number | null;
  medianHouseholdIncome: number | null;
  medianHomeValue: number | null;
  housingGrowth: number | null;
  primaryInRadius: number;
  secondaryInRadius: number;
  primaryPlusSecondaryInRadius: number;
  ownerHhPerPrimary: number | null;
  reviewsMedian: number | null;
  reviews100: number;
  reviews250: number;
  reviews500: number;
  reviews1000: number;
  top5ReviewsAvg: number | null;
  ownerHhPer100: number | null;
  ownerHhPer250: number | null;
  ownerHhPer500: number | null;
  demoQualityFlag: string | null;
  validForRanking: boolean;
  zctaCodes: string[];
};

type Weights = {
  name: "baseline" | "market_heavy" | "competition_heavy";
  ownerHh: number;
  income: number;
  housingGrowth: number;
  primaryScarcity: number;
  establishedScarcity: number;
  incumbentStrength: number;
};

const WEIGHTS: Weights[] = [
  {
    name: "baseline",
    ownerHh: 0.25,
    income: 0.1,
    housingGrowth: 0.1,
    primaryScarcity: 0.2,
    establishedScarcity: 0.25,
    incumbentStrength: 0.1,
  },
  {
    name: "market_heavy",
    ownerHh: 0.35,
    income: 0.15,
    housingGrowth: 0.1,
    primaryScarcity: 0.15,
    establishedScarcity: 0.15,
    incumbentStrength: 0.1,
  },
  {
    name: "competition_heavy",
    ownerHh: 0.15,
    income: 0.05,
    housingGrowth: 0.1,
    primaryScarcity: 0.25,
    establishedScarcity: 0.35,
    incumbentStrength: 0.1,
  },
];

/** Midrank percentile 0–100. Higher raw → higher score when higherIsBetter. */
function percentileScores(
  values: Array<number | null>,
  higherIsBetter: boolean,
): Array<number | null> {
  const indexed = values
    .map((v, i) => ({ v, i }))
    .filter((x): x is { v: number; i: number } => x.v != null && Number.isFinite(x.v));
  const n = indexed.length;
  const out: Array<number | null> = values.map(() => null);
  if (n === 0) return out;
  if (n === 1) {
    out[indexed[0]!.i] = 50;
    return out;
  }

  indexed.sort((a, b) => a.v - b.v);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n && indexed[j]!.v === indexed[i]!.v) j++;
    // average rank of ties (0-based), convert to percentile
    const avgRank = (i + (j - 1)) / 2;
    const pctHigher = (avgRank / (n - 1)) * 100;
    const score = higherIsBetter ? pctHigher : 100 - pctHigher;
    for (let k = i; k < j; k++) {
      out[indexed[k]!.i] = score;
    }
    i = j;
  }
  return out;
}

function spearman(ranksA: number[], ranksB: number[]): number | null {
  const n = ranksA.length;
  if (n < 3) return null;
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = ranksA[i]! - ranksB[i]!;
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const phase4Path = join(PHASE4, "clean-analysis-dataset.json");
  if (!existsSync(phase4Path)) {
    throw new Error("Missing Phase IV dataset. Run npm run analyze:phase4 first.");
  }
  const phase4 = JSON.parse(readFileSync(phase4Path, "utf8")) as Phase4Row[];
  const phase4Report = existsSync(join(PHASE4, "phase4-report.json"))
    ? (JSON.parse(readFileSync(join(PHASE4, "phase4-report.json"), "utf8")) as {
        secondarySensitivity?: { materialLoas?: Array<{ loa: string; pctChange: number }> };
      })
    : {};
  const secondaryMaterial = new Map(
    (phase4Report.secondarySensitivity?.materialLoas ?? []).map((m) => [
      m.loa,
      m.pctChange,
    ]),
  );

  const eligible = phase4.filter(
    (r) =>
      r.validForRanking &&
      (r.demoQualityFlag === "ok" || r.demoQualityFlag === "corrected") &&
      (r.ownerOccupiedHouseholds ?? 0) >= OWNER_HH_FLOOR,
  );
  const watchlistPool = phase4.filter(
    (r) =>
      r.validForRanking &&
      (r.demoQualityFlag === "ok" || r.demoQualityFlag === "corrected") &&
      (r.ownerOccupiedHouseholds ?? 0) < OWNER_HH_FLOOR,
  );

  console.log(
    `Eligible: ${eligible.length} · Watchlist pool: ${watchlistPool.length}`,
  );

  // Raw vectors for percentile scoring among eligible only
  const ownerHhRaw = eligible.map((r) => r.ownerOccupiedHouseholds);
  const incomeRaw = eligible.map((r) => r.medianHouseholdIncome);
  const growthRaw = eligible.map((r) => r.housingGrowth);
  const primaryScarRaw = eligible.map((r) => r.ownerHhPerPrimary);
  // Zero 100+ → maximum scarcity: use a sentinel above all finite ratios
  const finite100 = eligible
    .map((r) => r.ownerHhPer100)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const max100 = finite100.length ? Math.max(...finite100) : 0;
  const establishedRaw = eligible.map((r) => {
    if ((r.reviews100 ?? 0) === 0) return max100 + 1; // max scarcity
    return r.ownerHhPer100;
  });
  // Lower top-5 reviews = better. Zero competitors → treat as 0 reviews (best)
  const incumbentRaw = eligible.map((r) => {
    if (r.primaryInRadius === 0) return 0;
    return r.top5ReviewsAvg ?? 0;
  });

  const scoreOwnerHh = percentileScores(ownerHhRaw, true);
  const scoreIncome = percentileScores(incomeRaw, true);
  const scoreGrowth = percentileScores(growthRaw, true);
  const scorePrimaryScar = percentileScores(primaryScarRaw, true);
  const scoreEstablished = percentileScores(establishedRaw, true);
  const scoreIncumbent = percentileScores(incumbentRaw, false); // reverse

  type Scored = Phase4Row & {
    components: {
      ownerHh: number;
      income: number;
      housingGrowth: number;
      primaryScarcity: number;
      establishedScarcity: number;
      incumbentStrength: number;
    };
    scores: Record<string, number>;
    ranks: Record<string, number>;
    secondaryRiskFlag: boolean;
    secondaryPctChange: number | null;
    ownerHhPer100Effective: number | null;
  };

  const scored: Scored[] = eligible.map((r, i) => {
    const components = {
      ownerHh: scoreOwnerHh[i]!,
      income: scoreIncome[i]!,
      housingGrowth: scoreGrowth[i]!,
      primaryScarcity: scorePrimaryScar[i]!,
      establishedScarcity: scoreEstablished[i]!,
      incumbentStrength: scoreIncumbent[i]!,
    };
    const scores: Record<string, number> = {};
    for (const w of WEIGHTS) {
      scores[w.name] =
        components.ownerHh * w.ownerHh +
        components.income * w.income +
        components.housingGrowth * w.housingGrowth +
        components.primaryScarcity * w.primaryScarcity +
        components.establishedScarcity * w.establishedScarcity +
        components.incumbentStrength * w.incumbentStrength;
    }
    const secPct = secondaryMaterial.get(r.loa) ?? null;
    return {
      ...r,
      components,
      scores,
      ranks: {},
      secondaryRiskFlag: secPct != null && secPct >= 20,
      secondaryPctChange: secPct,
      ownerHhPer100Effective:
        (r.reviews100 ?? 0) === 0 ? null : r.ownerHhPer100,
    };
  });

  // Ranks per model
  for (const w of WEIGHTS) {
    const ordered = [...scored].sort(
      (a, b) => b.scores[w.name]! - a.scores[w.name]!,
    );
    ordered.forEach((row, idx) => {
      row.ranks[w.name] = idx + 1;
    });
  }

  const baselineOrdered = [...scored].sort(
    (a, b) => a.ranks.baseline! - b.ranks.baseline!,
  );

  // Rank correlation between models
  const idOrder = scored.map((s) => s.id);
  const rankVec = (model: string) =>
    idOrder.map((id) => scored.find((s) => s.id === id)!.ranks[model]!);
  const correlations = {
    baseline_vs_market_heavy: spearman(
      rankVec("baseline"),
      rankVec("market_heavy"),
    ),
    baseline_vs_competition_heavy: spearman(
      rankVec("baseline"),
      rankVec("competition_heavy"),
    ),
    market_heavy_vs_competition_heavy: spearman(
      rankVec("market_heavy"),
      rankVec("competition_heavy"),
    ),
  };

  const top10Sets = {
    baseline: new Set(
      scored.filter((s) => s.ranks.baseline! <= 10).map((s) => s.loa),
    ),
    market_heavy: new Set(
      scored.filter((s) => s.ranks.market_heavy! <= 10).map((s) => s.loa),
    ),
    competition_heavy: new Set(
      scored.filter((s) => s.ranks.competition_heavy! <= 10).map((s) => s.loa),
    ),
  };
  const robustTop10 = [...top10Sets.baseline].filter(
    (loa) =>
      top10Sets.market_heavy.has(loa) && top10Sets.competition_heavy.has(loa),
  );

  // Weight-sensitive: large rank swings across models
  const weightSensitive = scored
    .map((s) => {
      const ranks = [
        s.ranks.baseline!,
        s.ranks.market_heavy!,
        s.ranks.competition_heavy!,
      ];
      const spread = Math.max(...ranks) - Math.min(...ranks);
      return {
        loa: s.loa,
        state: s.state,
        baselineRank: s.ranks.baseline,
        marketHeavyRank: s.ranks.market_heavy,
        competitionHeavyRank: s.ranks.competition_heavy,
        rankSpread: spread,
        baselineScore: Number(s.scores.baseline!.toFixed(2)),
      };
    })
    .filter((x) => x.rankSpread >= 15)
    .sort((a, b) => b.rankSpread - a.rankSpread);

  // --- Clusters among Top 30 baseline ---
  const top30 = baselineOrdered.slice(0, 30);
  type Cluster = {
    id: string;
    name: string;
    members: Array<{
      loa: string;
      state: string;
      rank: number;
      score: number;
      isCenter: boolean;
    }>;
  };
  const assigned = new Set<string>();
  const clusters: Cluster[] = [];
  let clusterIdx = 0;

  for (const a of top30) {
    if (assigned.has(a.id)) continue;
    const members = [a];
    assigned.add(a.id);
    for (const b of top30) {
      if (assigned.has(b.id)) continue;
      const dist = distanceMiles(
        { lat: a.centerLat, lng: a.centerLng },
        { lat: b.centerLat, lng: b.centerLng },
      );
      const setA = new Set(a.zctaCodes);
      const setB = new Set(b.zctaCodes);
      const shared = [...setA].filter((z) => setB.has(z)).length;
      const union = new Set([...setA, ...setB]).size;
      const sharedPct = union > 0 ? shared / union : 0;
      const sameMacro = a.macroMarket === b.macroMarket;
      if (
        dist <= 15 ||
        (dist <= 20 && sharedPct >= 0.25) ||
        (sameMacro && dist <= 18 && sharedPct >= 0.15)
      ) {
        // also check proximity to any current member
        const nearAny = members.some((m) => {
          const d = distanceMiles(
            { lat: m.centerLat, lng: m.centerLng },
            { lat: b.centerLat, lng: b.centerLng },
          );
          const sh = [...new Set(m.zctaCodes)].filter((z) =>
            setB.has(z),
          ).length;
          const un = new Set([...m.zctaCodes, ...b.zctaCodes]).size;
          return d <= 15 || (d <= 20 && un > 0 && sh / un >= 0.25);
        });
        if (nearAny || dist <= 15) {
          members.push(b);
          assigned.add(b.id);
        }
      }
    }
    if (members.length >= 2) {
      clusterIdx += 1;
      members.sort((x, y) => x.ranks.baseline! - y.ranks.baseline!);
      const center = members[0]!;
      const name =
        members.length >= 2
          ? `${center.macroMarket} cluster`
          : center.loa;
      clusters.push({
        id: `cluster-${clusterIdx}`,
        name,
        members: members.map((m) => ({
          loa: m.loa,
          state: m.state,
          rank: m.ranks.baseline!,
          score: Number(m.scores.baseline!.toFixed(2)),
          isCenter: m.id === center.id,
        })),
      });
    }
  }

  // Top competitor details from DB for Top 30
  const pool = createAdminPgPool(4);
  const top30Detailed = [];
  for (const row of top30) {
    const { rows: comps } = await pool.query<{
      title: string | null;
      reviews_count: number | null;
      total_score: number | null;
      distance_miles: number | null;
    }>(
      `select b.title, b.reviews_count, b.total_score::float,
              min(s.distance_miles)::float as distance_miles
       from loa_gbp_sightings s
       join loa_gbp_businesses b on b.place_id = s.place_id
       where s.loa_id = $1
         and b.qualify_bucket = 'primary'
         and coalesce(s.in_radius,false) = true
         and coalesce(b.permanently_closed,false) = false
       group by b.place_id, b.title, b.reviews_count, b.total_score
       order by b.reviews_count desc nulls last
       limit 5`,
      [row.id],
    );

    top30Detailed.push({
      rank: row.ranks.baseline,
      loa: row.loa,
      state: row.state,
      macroMarket: row.macroMarket,
      opportunityScore: Number(row.scores.baseline!.toFixed(2)),
      market: {
        population: row.population,
        ownerHh: row.ownerOccupiedHouseholds,
        mhi: row.medianHouseholdIncome,
        medianHomeValue: row.medianHomeValue,
        housingGrowth: row.housingGrowth,
        populationGrowth: row.populationGrowth,
      },
      competition: {
        primary: row.primaryInRadius,
        medianReviews: row.reviewsMedian,
        reviews100: row.reviews100,
        reviews250: row.reviews250,
        reviews500: row.reviews500,
        reviews1000: row.reviews1000,
        top5AvgReviews: row.top5ReviewsAvg,
        ownerHhPerPrimary: row.ownerHhPerPrimary,
        ownerHhPer100: row.ownerHhPer100,
        ownerHhPer250: row.ownerHhPer250,
        ownerHhPer500: row.ownerHhPer500,
      },
      components: {
        ownerHh: Number(row.components.ownerHh.toFixed(2)),
        income: Number(row.components.income.toFixed(2)),
        housingGrowth: Number(row.components.housingGrowth.toFixed(2)),
        primaryScarcity: Number(row.components.primaryScarcity.toFixed(2)),
        establishedScarcity: Number(
          row.components.establishedScarcity.toFixed(2),
        ),
        incumbentStrength: Number(row.components.incumbentStrength.toFixed(2)),
      },
      ranksByModel: {
        baseline: row.ranks.baseline,
        marketHeavy: row.ranks.market_heavy,
        competitionHeavy: row.ranks.competition_heavy,
      },
      secondaryRiskFlag: row.secondaryRiskFlag,
      secondaryPctChange: row.secondaryPctChange,
      top5Competitors: comps.map((c, i) => ({
        rank: i + 1,
        name: c.title,
        reviews: c.reviews_count,
        rating: c.total_score,
        distanceMiles: c.distance_miles,
      })),
    });
  }

  // Small-market watchlist
  const smallWatchlist = watchlistPool
    .map((r) => {
      const noEstablished = (r.reviews100 ?? 0) === 0;
      const highGrowth = (r.housingGrowth ?? 0) >= 10;
      const highIncome = (r.medianHouseholdIncome ?? 0) >= 85000;
      const sparse =
        r.ownerHhPerPrimary != null && r.ownerHhPerPrimary >= 3000;
      const interesting =
        (noEstablished && (highGrowth || highIncome || sparse)) ||
        (highGrowth && sparse) ||
        (highIncome && noEstablished);
      return { r, noEstablished, highGrowth, highIncome, sparse, interesting };
    })
    .filter((x) => x.interesting)
    .sort(
      (a, b) =>
        (b.r.housingGrowth ?? 0) - (a.r.housingGrowth ?? 0) ||
        (b.r.medianHouseholdIncome ?? 0) - (a.r.medianHouseholdIncome ?? 0),
    )
    .slice(0, 15)
    .map((x) => ({
      loa: x.r.loa,
      state: x.r.state,
      ownerHh: x.r.ownerOccupiedHouseholds,
      mhi: x.r.medianHouseholdIncome,
      housingGrowth: x.r.housingGrowth,
      primary: x.r.primaryInRadius,
      reviews100: x.r.reviews100,
      ownerHhPerPrimary: x.r.ownerHhPerPrimary,
      reasons: [
        x.noEstablished ? "no 100+ review roofers" : null,
        x.highGrowth ? "housing growth ≥10%" : null,
        x.highIncome ? "MHI ≥$85k" : null,
        x.sparse ? "ownerHH/primary ≥3000" : null,
      ].filter(Boolean),
    }));

  // Suspicious / counterintuitive
  const suspicious: string[] = [];
  for (const row of top30.slice(0, 15)) {
    if ((row.ownerOccupiedHouseholds ?? 0) < 20000) {
      suspicious.push(
        `${row.loa}: Top-ranked with owner HH <20k — verify scarcity isn't just tiny market.`,
      );
    }
    if ((row.primaryInRadius ?? 0) >= 80 && row.ranks.baseline! <= 10) {
      suspicious.push(
        `${row.loa}: Top 10 despite ${row.primaryInRadius} primary roofers — driven by size/economics + ratio math.`,
      );
    }
    if (row.secondaryRiskFlag) {
      suspicious.push(
        `${row.loa}: Secondary-category roofing would raise competition ≥20% (Phase IV).`,
      );
    }
    if ((row.reviews100 ?? 0) === 0 && (row.ownerOccupiedHouseholds ?? 0) >= 30000) {
      suspicious.push(
        `${row.loa}: Zero 100+ review primary roofers at owner HH ≥30k — unusual; verify discovery coverage.`,
      );
    }
  }

  // Persist scores to DB
  await pool.query(`
    create table if not exists public.loa_opportunity_scores (
      loa_id uuid not null references public.local_opportunity_areas(id) on delete cascade,
      model text not null,
      eligible boolean not null default false,
      eligibility_reason text,
      rank integer,
      opportunity_score numeric,
      score_owner_hh numeric,
      score_income numeric,
      score_housing_growth numeric,
      score_primary_scarcity numeric,
      score_established_scarcity numeric,
      score_incumbent_strength numeric,
      owner_occupied_households integer,
      median_household_income numeric,
      housing_growth numeric,
      primary_in_radius integer,
      owner_hh_per_primary numeric,
      reviews_100_plus integer,
      owner_hh_per_100_plus numeric,
      top5_reviews_avg numeric,
      secondary_risk_flag boolean not null default false,
      cluster_id text,
      cluster_name text,
      cluster_center boolean not null default false,
      computed_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (loa_id, model)
    )
  `);

  // Apply migration pieces if needed
  try {
    await pool.query(`
      alter table public.loa_opportunity_scores enable row level security;
    `);
  } catch {
    // ignore
  }

  await pool.query(`delete from loa_opportunity_scores`);

  const clusterByLoa = new Map<
    string,
    { id: string; name: string; isCenter: boolean }
  >();
  for (const c of clusters) {
    for (const m of c.members) {
      clusterByLoa.set(m.loa, {
        id: c.id,
        name: c.name,
        isCenter: m.isCenter,
      });
    }
  }

  for (const w of WEIGHTS) {
    for (const row of scored) {
      const cl = clusterByLoa.get(row.loa);
      await pool.query(
        `insert into loa_opportunity_scores (
          loa_id, model, eligible, eligibility_reason, rank, opportunity_score,
          score_owner_hh, score_income, score_housing_growth,
          score_primary_scarcity, score_established_scarcity, score_incumbent_strength,
          owner_occupied_households, median_household_income, housing_growth,
          primary_in_radius, owner_hh_per_primary, reviews_100_plus,
          owner_hh_per_100_plus, top5_reviews_avg, secondary_risk_flag,
          cluster_id, cluster_name, cluster_center, computed_at, updated_at
        ) values (
          $1,$2,true,'owner_hh>=10000',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now(),now()
        )
        on conflict (loa_id, model) do update set
          rank = excluded.rank,
          opportunity_score = excluded.opportunity_score,
          score_owner_hh = excluded.score_owner_hh,
          score_income = excluded.score_income,
          score_housing_growth = excluded.score_housing_growth,
          score_primary_scarcity = excluded.score_primary_scarcity,
          score_established_scarcity = excluded.score_established_scarcity,
          score_incumbent_strength = excluded.score_incumbent_strength,
          secondary_risk_flag = excluded.secondary_risk_flag,
          cluster_id = excluded.cluster_id,
          cluster_name = excluded.cluster_name,
          cluster_center = excluded.cluster_center,
          updated_at = now()`,
        [
          row.id,
          w.name,
          row.ranks[w.name],
          row.scores[w.name],
          row.components.ownerHh,
          row.components.income,
          row.components.housingGrowth,
          row.components.primaryScarcity,
          row.components.establishedScarcity,
          row.components.incumbentStrength,
          row.ownerOccupiedHouseholds,
          row.medianHouseholdIncome,
          row.housingGrowth,
          row.primaryInRadius,
          row.ownerHhPerPrimary,
          row.reviews100,
          row.ownerHhPer100,
          row.top5ReviewsAvg,
          row.secondaryRiskFlag,
          cl?.id ?? null,
          cl?.name ?? null,
          cl?.isCenter ?? false,
        ],
      );
    }
  }

  // Mark ineligible in baseline model for completeness
  for (const row of phase4) {
    if (eligible.some((e) => e.id === row.id)) continue;
    const reason =
      (row.ownerOccupiedHouseholds ?? 0) < OWNER_HH_FLOOR
        ? "owner_hh_below_10000"
        : "demographic_quality";
    for (const w of WEIGHTS) {
      await pool.query(
        `insert into loa_opportunity_scores (
          loa_id, model, eligible, eligibility_reason, computed_at, updated_at
        ) values ($1,$2,false,$3,now(),now())
        on conflict (loa_id, model) do update set
          eligible = false,
          eligibility_reason = excluded.eligibility_reason,
          updated_at = now()`,
        [row.id, w.name, reason],
      );
    }
  }

  const fullRanking = baselineOrdered.map((r) => ({
    rank: r.ranks.baseline,
    state: r.state,
    loa: r.loa,
    macroMarket: r.macroMarket,
    opportunityScore: Number(r.scores.baseline!.toFixed(2)),
    ownerHh: r.ownerOccupiedHouseholds,
    mhi: r.medianHouseholdIncome,
    housingGrowth: r.housingGrowth,
    primary: r.primaryInRadius,
    ownerHhPerPrimary: r.ownerHhPerPrimary,
    reviews100: r.reviews100,
    ownerHhPer100: r.ownerHhPer100,
    top5AvgReviews: r.top5ReviewsAvg,
    components: {
      ownerHh: Number(r.components.ownerHh.toFixed(2)),
      income: Number(r.components.income.toFixed(2)),
      housingGrowth: Number(r.components.housingGrowth.toFixed(2)),
      primaryScarcity: Number(r.components.primaryScarcity.toFixed(2)),
      establishedScarcity: Number(r.components.establishedScarcity.toFixed(2)),
      incumbentStrength: Number(r.components.incumbentStrength.toFixed(2)),
    },
    ranksByModel: {
      baseline: r.ranks.baseline,
      marketHeavy: r.ranks.market_heavy,
      competitionHeavy: r.ranks.competition_heavy,
    },
    scoresByModel: {
      baseline: Number(r.scores.baseline!.toFixed(2)),
      marketHeavy: Number(r.scores.market_heavy!.toFixed(2)),
      competitionHeavy: Number(r.scores.competition_heavy!.toFixed(2)),
    },
    secondaryRiskFlag: r.secondaryRiskFlag,
  }));

  const implementation = {
    eligibility: "owner_occupied_households >= 10000 AND demo_quality in (ok, corrected)",
    normalization:
      "Midrank percentile (0–100) computed only among eligible LOAs. Ties share average rank. Formula: percentile = avgRank/(n-1)*100 for ascending values; reverse for Top-5 reviews.",
    zeroEstablished100Plus:
      "LOAs with zero 100+ review primary roofers receive maximum established-scarcity component (sentinel above max finite ownerHH/100+).",
    zeroPrimaryCompetitors:
      "LOAs with zero primary competitors use top5_reviews_avg = 0 for incumbent component (maximum component score after reverse scoring).",
    outlierHandling:
      "Percentile ranking alone; no winsorization. Extreme raw values cannot exceed 0–100 component bounds.",
    weights: WEIGHTS,
  };

  const report = {
    summary: {
      eligibleLoas: eligible.length,
      watchlistPool: watchlistPool.length,
      ownerHhFloor: OWNER_HH_FLOOR,
      robustTop10AcrossAllModels: robustTop10,
      rankCorrelations: correlations,
      clusterCount: clusters.length,
      smallWatchlistCount: smallWatchlist.length,
    },
    implementation,
    fullRanking,
    top30Detailed,
    clusters,
    sensitivity: {
      top10ByModel: {
        baseline: scored
          .filter((s) => s.ranks.baseline! <= 10)
          .sort((a, b) => a.ranks.baseline! - b.ranks.baseline!)
          .map((s) => ({ rank: s.ranks.baseline, loa: s.loa, state: s.state, score: Number(s.scores.baseline!.toFixed(2)) })),
        marketHeavy: scored
          .filter((s) => s.ranks.market_heavy! <= 10)
          .sort((a, b) => a.ranks.market_heavy! - b.ranks.market_heavy!)
          .map((s) => ({
            rank: s.ranks.market_heavy,
            loa: s.loa,
            state: s.state,
            score: Number(s.scores.market_heavy!.toFixed(2)),
          })),
        competitionHeavy: scored
          .filter((s) => s.ranks.competition_heavy! <= 10)
          .sort(
            (a, b) => a.ranks.competition_heavy! - b.ranks.competition_heavy!,
          )
          .map((s) => ({
            rank: s.ranks.competition_heavy,
            loa: s.loa,
            state: s.state,
            score: Number(s.scores.competition_heavy!.toFixed(2)),
          })),
      },
      robustTop10,
      weightSensitive: weightSensitive.slice(0, 25),
      correlations,
    },
    smallMarketWatchlist: smallWatchlist,
    secondaryRiskTop30: top30Detailed
      .filter((t) => t.secondaryRiskFlag)
      .map((t) => ({
        rank: t.rank,
        loa: t.loa,
        state: t.state,
        secondaryPctChange: t.secondaryPctChange,
      })),
    suspicious,
  };

  writeFileSync(join(OUT, "phase5-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(OUT, "opportunity-ranking-full.json"),
    JSON.stringify(fullRanking, null, 2),
  );

  const keys = [
    "rank",
    "state",
    "loa",
    "macroMarket",
    "opportunityScore",
    "ownerHh",
    "mhi",
    "housingGrowth",
    "primary",
    "ownerHhPerPrimary",
    "reviews100",
    "ownerHhPer100",
    "top5AvgReviews",
    "comp_ownerHh",
    "comp_income",
    "comp_housingGrowth",
    "comp_primaryScarcity",
    "comp_establishedScarcity",
    "comp_incumbentStrength",
    "rank_marketHeavy",
    "rank_competitionHeavy",
    "secondaryRiskFlag",
  ] as const;

  const csvRows = fullRanking.map((r) => ({
    ...r,
    comp_ownerHh: r.components.ownerHh,
    comp_income: r.components.income,
    comp_housingGrowth: r.components.housingGrowth,
    comp_primaryScarcity: r.components.primaryScarcity,
    comp_establishedScarcity: r.components.establishedScarcity,
    comp_incumbentStrength: r.components.incumbentStrength,
    rank_marketHeavy: r.ranksByModel.marketHeavy,
    rank_competitionHeavy: r.ranksByModel.competitionHeavy,
  }));

  const csv = [
    keys.join(","),
    ...csvRows.map((row) =>
      keys.map((k) => csvEscape((row as Record<string, unknown>)[k])).join(","),
    ),
  ].join("\n");
  writeFileSync(join(OUT, "opportunity-ranking.csv"), csv);

  console.log(JSON.stringify(report.summary, null, 2));
  console.log("\nBaseline Top 15:");
  for (const r of fullRanking.slice(0, 15)) {
    console.log(
      `${String(r.rank).padStart(2)}. ${r.state.padEnd(12)} ${r.opportunityScore.toFixed(1).padStart(5)}  ${r.loa.slice(0, 48)}`,
    );
  }
  console.log("\nRobust Top 10 (all models):", robustTop10);
  console.log("\nClusters:", clusters.map((c) => `${c.name} (${c.members.length})`));
  console.log(`\nWrote ${OUT}`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
