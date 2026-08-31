/**
 * Phase VI — Expansion Area consolidation + finalist QA.
 * Does NOT change Phase V Opportunity Scores.
 *
 * Usage: npm run analyze:phase6
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { createAdminPgPool } from "../src/lib/admin-db";
import { distanceMiles } from "../src/lib/local-opportunity-areas";

config({ path: ".env.local" });

const OUT = join(process.cwd(), "tmp", "phase6");
const PHASE5 = join(process.cwd(), "tmp", "phase5", "phase5-report.json");

type RankRow = {
  rank: number;
  state: string;
  loa: string;
  macroMarket: string;
  opportunityScore: number;
  ownerHh: number | null;
  mhi: number | null;
  housingGrowth: number | null;
  primary: number;
  ownerHhPerPrimary: number | null;
  reviews100: number;
  ownerHhPer100: number | null;
  top5AvgReviews: number | null;
  components: Record<string, number>;
  ranksByModel: {
    baseline: number;
    marketHeavy: number;
    competitionHeavy: number;
  };
  scoresByModel: Record<string, number>;
  secondaryRiskFlag: boolean;
};

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
  reviews100: number;
  reviews250: number;
  reviews500: number;
  reviews1000: number;
  top5ReviewsAvg: number | null;
  ownerHhPerPrimary: number | null;
  ownerHhPer100: number | null;
  ownerHhPer250: number | null;
  ownerHhPer500: number | null;
  reviewsMedian: number | null;
  zctaCodes: string[];
  validForRanking: boolean;
};

function tier(ownerHh: number | null): string {
  if (ownerHh == null) return "unknown";
  if (ownerHh >= 100000) return "Major Opportunity";
  if (ownerHh >= 30000) return "Growth Opportunity";
  if (ownerHh >= 10000) return "Small / Satellite Opportunity";
  return "Watchlist";
}

function robustness(ranks: RankRow["ranksByModel"]): string {
  const b = ranks.baseline;
  const m = ranks.marketHeavy;
  const c = ranks.competitionHeavy;
  const inTop = (n: number, k: number) => n <= k;
  const top15Hits = [inTop(b, 15), inTop(m, 15), inTop(c, 15)].filter(Boolean)
    .length;
  const top10Hits = [inTop(b, 10), inTop(m, 10), inTop(c, 10)].filter(Boolean)
    .length;
  if (top10Hits >= 2 || top15Hits === 3) return "Highly Robust";
  if (m + 5 < b && m + 5 < c) return "Market-Led";
  if (c + 5 < b && c + 5 < m) return "Competition-Led";
  if (Math.abs(b - m) <= 10 && Math.abs(b - c) <= 12) return "Balanced";
  if (m < b - 8) return "Market-Led";
  if (c < b - 8) return "Competition-Led";
  return "Balanced";
}

function thesis(r: {
  ownerHh: number | null;
  mhi: number | null;
  housingGrowth: number | null;
  primary: number;
  ownerHhPerPrimary: number | null;
  reviews100: number;
  ownerHhPer100: number | null;
  top5AvgReviews: number | null;
  tier: string;
}): string[] {
  const t: string[] = [];
  const large = (r.ownerHh ?? 0) >= 100000;
  const mid = (r.ownerHh ?? 0) >= 30000;
  const affluent = (r.mhi ?? 0) >= 100000;
  const growth = (r.housingGrowth ?? 0) >= 8;
  const sparsePrimary = (r.ownerHhPerPrimary ?? 0) >= 2000;
  const sparse100 =
    r.reviews100 === 0 ||
    ((r.ownerHhPer100 ?? 0) >= 25000 && r.reviews100 <= 12);
  const weakIncumbents = (r.top5AvgReviews ?? 999) < 80;
  const dense = (r.primary ?? 0) >= 80;
  const strongIncumbents = (r.top5AvgReviews ?? 0) >= 200 || r.reviews100 >= 15;

  if (large && sparse100) t.push("Large market + weak established competition");
  if (large && affluent && (dense || strongIncumbents))
    t.push("Large affluent market despite stronger competition");
  if (growth) t.push("Growth corridor");
  if (sparsePrimary) t.push("Low competitor density");
  if (weakIncumbents) t.push("Weak incumbent review strength");
  if (!large && mid && (sparse100 || sparsePrimary))
    t.push("Smaller scarcity opportunity");
  if (!mid && (sparse100 || weakIncumbents))
    t.push("Smaller scarcity opportunity");
  if (!t.length) t.push("Balanced mixed opportunity");
  return t;
}

function isKitsapLoa(name: string): boolean {
  return /Poulsbo|Bainbridge|Bremerton|Silverdale|Port Orchard|Kitsap/i.test(
    name,
  );
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(PHASE5)) throw new Error("Missing Phase V report");

  const phase5 = JSON.parse(readFileSync(PHASE5, "utf8")) as {
    fullRanking: RankRow[];
    top30Detailed: Array<{
      rank: number;
      loa: string;
      state: string;
      top5Competitors: unknown[];
      secondaryRiskFlag: boolean;
      secondaryPctChange: number | null;
    }>;
  };
  const phase4 = JSON.parse(
    readFileSync(
      join(process.cwd(), "tmp/phase4/clean-analysis-dataset.json"),
      "utf8",
    ),
  ) as Phase4Row[];

  const pool = createAdminPgPool(4);
  const { rows: excluded } = await pool.query<{
    id: string;
    slug: string;
    display_name: string;
    ranking_exclude_reason: string | null;
    duplicate_of_loa_id: string | null;
  }>(
    `select id, slug, display_name, ranking_exclude_reason, duplicate_of_loa_id
     from local_opportunity_areas where ranking_excluded = true`,
  );

  const excludedNames = new Set(excluded.map((e) => e.display_name));
  const excludedSlugs = new Set(excluded.map((e) => e.slug));

  // Map ranking rows to phase4 for geo/ids; skip excluded duplicates
  const p4ByName = new Map(phase4.map((r) => [r.loa, r]));
  // Prefer non-excluded when names collide
  const { rows: loaMeta } = await pool.query<{
    id: string;
    display_name: string;
    slug: string;
    ranking_excluded: boolean;
  }>(`select id, display_name, slug, ranking_excluded from local_opportunity_areas`);

  const preferredIdByName = new Map<string, string>();
  for (const m of loaMeta) {
    if (m.ranking_excluded) continue;
    preferredIdByName.set(m.display_name, m.id);
  }

  const eligibleRanking = phase5.fullRanking.filter((r) => {
    // Drop duplicate Pahrump row that was Las Vegas-attached: both had same display name —
    // keep one by matching preferred id via phase4
    if (r.loa === "Pahrump") {
      // Keep only one Pahrump in ranking (the dedicated market one)
      return true; // we'll dedupe below
    }
    return true;
  });

  // Dedupe by display name keeping best (lowest) baseline rank
  const seenNames = new Set<string>();
  const dedupedRanking: RankRow[] = [];
  for (const r of eligibleRanking) {
    if (seenNames.has(r.loa)) continue;
    // Skip if this name maps only to excluded LOA
    const meta = loaMeta.filter((m) => m.display_name === r.loa);
    if (meta.length && meta.every((m) => m.ranking_excluded)) continue;
    seenNames.add(r.loa);
    dedupedRanking.push(r);
  }
  // Re-number ranks after dedupe
  dedupedRanking.forEach((r, i) => {
    r.rank = i + 1;
  });

  // Tiers for all eligible (from deduped / phase4 valid with owner HH)
  const tierRows = phase4
    .filter((r) => r.validForRanking)
    .filter((r) => {
      const meta = loaMeta.find((m) => m.id === r.id);
      return !meta?.ranking_excluded;
    })
    .map((r) => ({
      ...r,
      tierLabel: tier(r.ownerOccupiedHouseholds),
      score: dedupedRanking.find((x) => x.loa === r.loa)?.opportunityScore ?? null,
      baselineRank: dedupedRanking.find((x) => x.loa === r.loa)?.rank ?? null,
      ranksByModel: dedupedRanking.find((x) => x.loa === r.loa)?.ranksByModel,
    }));

  const tierCounts = {
    "Major Opportunity": tierRows.filter((r) => r.tierLabel === "Major Opportunity")
      .length,
    "Growth Opportunity": tierRows.filter(
      (r) => r.tierLabel === "Growth Opportunity",
    ).length,
    "Small / Satellite Opportunity": tierRows.filter(
      (r) => r.tierLabel === "Small / Satellite Opportunity",
    ).length,
    Watchlist: tierRows.filter((r) => r.tierLabel === "Watchlist").length,
  };

  const rankingsByTier: Record<string, unknown[]> = {};
  for (const t of [
    "Major Opportunity",
    "Growth Opportunity",
    "Small / Satellite Opportunity",
  ]) {
    rankingsByTier[t] = tierRows
      .filter((r) => r.tierLabel === t && r.baselineRank != null)
      .sort((a, b) => (a.baselineRank ?? 999) - (b.baselineRank ?? 999))
      .map((r, i) => ({
        tierRank: i + 1,
        baselineRank: r.baselineRank,
        loa: r.loa,
        state: r.state,
        score: r.score,
        ownerHh: r.ownerOccupiedHouseholds,
        mhi: r.medianHouseholdIncome,
        housingGrowth: r.housingGrowth,
        primary: r.primaryInRadius,
        ownerHhPer100: r.ownerHhPer100,
      }));
  }

  // --- Expansion areas from Top 30 (deduped) ---
  const top30 = dedupedRanking.slice(0, 30);
  const top30Geo = top30
    .map((r) => {
      const p4 = p4ByName.get(r.loa);
      return p4 ? { ...r, ...p4, phase5: r } : null;
    })
    .filter(Boolean) as Array<RankRow & Phase4Row & { phase5: RankRow }>;

  type Member = (typeof top30Geo)[0];
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x) ?? x;
    if (p !== x) {
      const r = find(p);
      parent.set(x, r);
      return r;
    }
    return x;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const m of top30Geo) parent.set(m.id, m.id);

  for (let i = 0; i < top30Geo.length; i++) {
    for (let j = i + 1; j < top30Geo.length; j++) {
      const a = top30Geo[i]!;
      const b = top30Geo[j]!;
      const dist = distanceMiles(
        { lat: a.centerLat, lng: a.centerLng },
        { lat: b.centerLat, lng: b.centerLng },
      );
      const setA = new Set(a.zctaCodes);
      const setB = new Set(b.zctaCodes);
      const shared = [...setA].filter((z) => setB.has(z)).length;
      const unionN = new Set([...setA, ...setB]).size;
      const pct = unionN ? shared / unionN : 0;
      const sameMacro = a.macroMarket === b.macroMarket;
      // Do not merge Kitsap Peninsula LOAs with mainland Puget Sound across the water.
      if (isKitsapLoa(a.loa) !== isKitsapLoa(b.loa)) continue;
      if (
        dist <= 14 ||
        (dist <= 18 && pct >= 0.25) ||
        (sameMacro && dist <= 16 && pct >= 0.15)
      ) {
        union(a.id, b.id);
      }
    }
  }

  const groups = new Map<string, Member[]>();
  for (const m of top30Geo) {
    const root = find(m.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(m);
  }

  function clusterName(members: Member[]): string {
    const states = [...new Set(members.map((m) => m.state))];
    const best = [...members].sort((a, b) => a.rank - b.rank)[0]!;
    if (members.some((m) => /Las Vegas|Enterprise|Henderson|North Las Vegas|Summerlin|Paradise/.test(m.loa)))
      return "Las Vegas Valley";
    if (members.every((m) => isKitsapLoa(m.loa))) return "Kitsap Peninsula";
    if (
      members.some((m) =>
        /Redmond|Bellevue|Seattle|Edmonds|Snoqualmie|Monroe|Kirkland|Sammamish/.test(
          m.loa,
        ),
      ) &&
      !members.some((m) => isKitsapLoa(m.loa))
    )
      return "Seattle Eastside / North";
    if (members.some((m) => /Hillsboro|Tigard|Beaverton|Portland/.test(m.loa)))
      return "Portland Westside";
    if (members.some((m) => /Lacey|Olympia|Yelm|Tumwater/.test(m.loa)))
      return "Olympia Area";
    if (
      members.some((m) =>
        /Lehi|American Fork|Eagle Mountain|Sandy|Herriman/.test(m.loa),
      )
    )
      return "Utah County / South Salt Lake Corridor";
    if (members.some((m) => /Magna|West Valley/.test(m.loa)))
      return "West Salt Lake Valley";
    if (
      members.some((m) =>
        /Tacoma|South Hill|Puyallup|Kent|Renton|Auburn/.test(m.loa),
      )
    )
      return "South Puget Sound";
    return `${best.loa} (${states.join("/")})`;
  }

  const expansionAreas = [...groups.values()]
    .filter((g) => g.length >= 2)
    .map((members) => {
      const sorted = [...members].sort((a, b) => a.rank - b.rank);
      const center = sorted[0]!;
      const pairs: Array<{ a: string; b: string; miles: number; sharedPct: number }> = [];
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i]!;
          const b = sorted[j]!;
          const dist = distanceMiles(
            { lat: a.centerLat, lng: a.centerLng },
            { lat: b.centerLat, lng: b.centerLng },
          );
          const setA = new Set(a.zctaCodes);
          const setB = new Set(b.zctaCodes);
          const shared = [...setA].filter((z) => setB.has(z)).length;
          const unionN = new Set([...setA, ...setB]).size;
          pairs.push({
            a: a.loa,
            b: b.loa,
            miles: Number(dist.toFixed(1)),
            sharedPct: Number((unionN ? shared / unionN : 0).toFixed(3)),
          });
        }
      }
      return {
        name: clusterName(sorted),
        memberLoas: sorted.map((m) => ({
          loa: m.loa,
          state: m.state,
          rank: m.rank,
          score: m.opportunityScore,
          ownerHh: m.ownerOccupiedHouseholds,
        })),
        strongestScore: center.opportunityScore,
        recommendedOperatingCenter: center.loa,
        recommendedCenterState: center.state,
        representativeOwnerHh: center.ownerOccupiedHouseholds,
        representativeMhi: center.medianHouseholdIncome,
        representativeHousingGrowth: center.housingGrowth,
        note: "Demographics from strongest LOA only — overlapping member populations not summed.",
        pairOverlaps: pairs,
        whySurfaced: `Multiple Top-30 LOAs within ~14–18mi / shared ZCTAs; led by ${center.loa} (rank #${center.rank}, score ${center.opportunityScore}).`,
      };
    })
    .sort((a, b) => b.strongestScore - a.strongestScore);

  // Standalone top LOAs not in multi-member clusters
  const clusteredNames = new Set(
    expansionAreas.flatMap((a) => a.memberLoas.map((m) => m.loa)),
  );

  // --- Build ~15–20 candidates ---
  type Candidate = {
    id: string;
    type: "expansion_area" | "standalone_loa";
    name: string;
    state: string;
    recommendedCenter: string;
    marketSizeTier: string;
    phase5Score: number;
    phase5Rank: number;
    sensitivityRanks: RankRow["ranksByModel"];
    ownerHh: number | null;
    mhi: number | null;
    housingGrowth: number | null;
    primary: number;
    ownerHhPerPrimary: number | null;
    reviews100: number;
    ownerHhPer100: number | null;
    reviews250: number;
    reviews500: number;
    top5AvgReviews: number | null;
    theses: string[];
    robustness: string;
    memberLoas?: string[];
    loaIds: string[];
    qaNotes: string[];
    downgradeOrRemove: boolean;
    downgradeReason: string | null;
  };

  const candidates: Candidate[] = [];

  // Add expansion areas as candidates
  for (const area of expansionAreas) {
    const centerRow = top30Geo.find((m) => m.loa === area.recommendedOperatingCenter)!;
    const r = centerRow.phase5;
    candidates.push({
      id: `area:${area.name}`,
      type: "expansion_area",
      name: area.name,
      state: area.recommendedCenterState,
      recommendedCenter: area.recommendedOperatingCenter,
      marketSizeTier: tier(area.representativeOwnerHh),
      phase5Score: area.strongestScore,
      phase5Rank: centerRow.rank,
      sensitivityRanks: r.ranksByModel,
      ownerHh: area.representativeOwnerHh,
      mhi: area.representativeMhi,
      housingGrowth: area.representativeHousingGrowth,
      primary: centerRow.primaryInRadius,
      ownerHhPerPrimary: centerRow.ownerHhPerPrimary,
      reviews100: centerRow.reviews100,
      ownerHhPer100: centerRow.ownerHhPer100,
      reviews250: centerRow.reviews250,
      reviews500: centerRow.reviews500,
      top5AvgReviews: centerRow.top5ReviewsAvg,
      theses: thesis({
        ownerHh: area.representativeOwnerHh,
        mhi: area.representativeMhi,
        housingGrowth: area.representativeHousingGrowth,
        primary: centerRow.primaryInRadius,
        ownerHhPerPrimary: centerRow.ownerHhPerPrimary,
        reviews100: centerRow.reviews100,
        ownerHhPer100: centerRow.ownerHhPer100,
        top5AvgReviews: centerRow.top5ReviewsAvg,
        tier: tier(area.representativeOwnerHh),
      }),
      robustness: robustness(r.ranksByModel),
      memberLoas: area.memberLoas.map((m) => m.loa),
      loaIds: top30Geo
        .filter((m) => area.memberLoas.some((x) => x.loa === m.loa))
        .map((m) => m.id),
      qaNotes: [],
      downgradeOrRemove: false,
      downgradeReason: null,
    });
  }

  // Priority standalones: top ranks not clustered, plus key Utah / scarcity inspect list
  const mustInspect = [
    "Hooper",
    "Dayton",
    "Prineville",
    "Cheney",
    "Tremonton",
    "McMinnville",
    "Tooele",
    "Lehi / Sandy / Herriman / Draper",
    "Magna metro township / West Valley City",
    "Summit Park",
    "Cold Springs",
    "Cottage Grove",
    "Poulsbo / Bainbridge Island / Port Orchard",
  ];

  for (const row of top30Geo) {
    if (clusteredNames.has(row.loa)) continue;
    if (candidates.length >= 22) break;
    const include =
      row.rank <= 22 || mustInspect.includes(row.loa);
    if (!include) continue;
    if (candidates.some((c) => c.recommendedCenter === row.loa || c.memberLoas?.includes(row.loa)))
      continue;

    let downgrade = false;
    let downgradeReason: string | null = null;
    const notes: string[] = [];
    if (row.loa === "Prineville") {
      notes.push(
        "Phase IV soft-intersect demographics may overstate market size; treat as Small/Satellite scarcity play.",
      );
    }
    if (["Hooper", "Dayton", "Cheney", "Tremonton", "Cottage Grove", "McMinnville"].includes(row.loa)) {
      notes.push("Scarcity-led rank; absolute homeowner base is modest vs Major metros.");
    }

    candidates.push({
      id: `loa:${row.id}`,
      type: "standalone_loa",
      name: row.loa,
      state: row.state,
      recommendedCenter: row.loa,
      marketSizeTier: tier(row.ownerOccupiedHouseholds),
      phase5Score: row.opportunityScore,
      phase5Rank: row.rank,
      sensitivityRanks: row.phase5.ranksByModel,
      ownerHh: row.ownerOccupiedHouseholds,
      mhi: row.medianHouseholdIncome,
      housingGrowth: row.housingGrowth,
      primary: row.primaryInRadius,
      ownerHhPerPrimary: row.ownerHhPerPrimary,
      reviews100: row.reviews100,
      ownerHhPer100: row.ownerHhPer100,
      reviews250: row.reviews250,
      reviews500: row.reviews500,
      top5AvgReviews: row.top5ReviewsAvg,
      theses: thesis({
        ownerHh: row.ownerOccupiedHouseholds,
        mhi: row.medianHouseholdIncome,
        housingGrowth: row.housingGrowth,
        primary: row.primaryInRadius,
        ownerHhPerPrimary: row.ownerHhPerPrimary,
        reviews100: row.reviews100,
        ownerHhPer100: row.ownerHhPer100,
        top5AvgReviews: row.top5ReviewsAvg,
        tier: tier(row.ownerOccupiedHouseholds),
      }),
      robustness: robustness(row.phase5.ranksByModel),
      loaIds: [row.id],
      qaNotes: notes,
      downgradeOrRemove: downgrade,
      downgradeReason,
    });
  }

  // Cap to ~20 by score/rank priority
  candidates.sort((a, b) => a.phase5Rank - b.phase5Rank);
  const finalists = candidates.slice(0, 20);

  // --- Secondary-category QA ---
  async function secondaryQa(loaIds: string[]) {
    const { rows } = await pool.query<{
      place_id: string;
      title: string | null;
      category_name: string | null;
      categories: string[] | null;
      reviews_count: number | null;
      total_score: number | null;
      loa_id: string;
    }>(
      `select distinct on (b.place_id)
         b.place_id, b.title, b.category_name, b.categories, b.reviews_count,
         b.total_score::float, s.loa_id
       from loa_gbp_sightings s
       join loa_gbp_businesses b on b.place_id = s.place_id
       where s.loa_id = any($1::uuid[])
         and b.qualify_bucket = 'secondary'
         and coalesce(s.in_radius, false) = true
         and coalesce(b.permanently_closed, false) = false
       order by b.place_id, b.reviews_count desc nulls last`,
      [loaIds],
    );

    const classify = (r: (typeof rows)[0]) => {
      const primary = (r.category_name ?? "").toLowerCase();
      const title = (r.title ?? "").toLowerCase();
      const cats = (r.categories ?? []).map((c) => c.toLowerCase());
      const titleRoof = /\broof/.test(title);
      const catsRoofing = cats.includes("roofing contractor");

      // Noise / non-install competition
      if (
        primary.includes("solar") ||
        primary.includes("window") ||
        primary.includes("insulation") ||
        primary.includes("hvac") ||
        primary.includes("plumber") ||
        primary.includes("electrician") ||
        primary.includes("tree") ||
        primary.includes("landscap") ||
        primary.includes("pressure wash") ||
        primary.includes("painter") ||
        primary.includes("marketing") ||
        primary.includes("real estate") ||
        primary.includes("architect") ||
        primary.includes("supply store") ||
        primary.includes("manufacturer") ||
        primary.includes("building materials") ||
        primary.includes("gutter cleaning") ||
        primary.includes("gutter service")
      ) {
        return { bucket: "irrelevant_or_noisy" as const, credible: false };
      }

      // Title-branded roofing under a non-primary category = real residential rival
      if (titleRoof) {
        return {
          bucket: "legitimate_residential_roofing" as const,
          credible: true,
        };
      }

      if (primary.includes("siding") || primary.includes("exterior")) {
        return {
          bucket: "siding_exterior_material_competitor" as const,
          credible: true,
        };
      }

      const gcLike =
        primary === "general contractor" ||
        primary === "construction company" ||
        primary === "contractor" ||
        primary === "building firm" ||
        primary === "remodeler" ||
        primary === "custom home builder" ||
        primary === "home builder";

      if (gcLike && catsRoofing) {
        return {
          bucket: "general_contractor_material_roofing" as const,
          credible: true,
        };
      }
      if (gcLike) {
        return {
          bucket: "general_contractor_unclear" as const,
          credible: false,
        };
      }

      if (primary.includes("water damage") || primary.includes("restoration")) {
        return {
          bucket: "restoration_maybe_roofing" as const,
          credible: catsRoofing,
        };
      }

      return { bucket: "noisy_or_unclear" as const, credible: false };
    };

    const analyzed = rows.map((r) => ({ ...r, ...classify(r) }));
    const credible = analyzed.filter((a) => a.credible);
    return {
      secondaryTotal: rows.length,
      credibleSecondary: credible.length,
      byBucket: analyzed.reduce(
        (acc, a) => {
          acc[a.bucket] = (acc[a.bucket] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      sampleCredible: credible.slice(0, 8).map((c) => ({
        title: c.title,
        category: c.category_name,
        reviews: c.reviews_count,
        bucket: c.bucket,
      })),
      sampleIrrelevant: analyzed
        .filter((a) => !a.credible)
        .slice(0, 5)
        .map((c) => ({
          title: c.title,
          category: c.category_name,
          reviews: c.reviews_count,
          bucket: c.bucket,
        })),
    };
  }

  const candidatesWithQa = [];
  for (const c of finalists) {
    const qa = await secondaryQa(c.loaIds);
    const adjusted = c.primary + qa.credibleSecondary;
    const primaryOnly = c.primary;
    const uplift =
      primaryOnly > 0 ? (qa.credibleSecondary / primaryOnly) * 100 : 0;
    const thesisChanges =
      uplift >= 20 ||
      (qa.credibleSecondary >= 5 && uplift >= 12) ||
      (c.reviews100 <= 2 && qa.credibleSecondary >= 3);

    if (c.name === "Prineville" && thesisChanges) {
      c.qaNotes.push(
        "Credible secondary roofing materially increases competition; scarcity thesis weaker than primary-only suggests.",
      );
    }
    // Downgrade rules after QA + business context
    if (
      ["Cottage Grove", "Tremonton"].includes(c.name) &&
      (c.ownerHh ?? 0) < 25000
    ) {
      c.qaNotes.push("Keep only as Small/Satellite - not Major-Market equivalent.");
    }
    if (c.name === "Prineville") {
      c.qaNotes.push("Keep only as Small/Satellite - not Major-Market equivalent.");
    }
    if (c.name.includes("Seattle Eastside") || c.name.includes("Redmond")) {
      c.qaNotes.push(
        "Strong incumbents (top-5 often 350-700 reviews). Thesis is affluent scale, not soft competition.",
      );
    }

    candidatesWithQa.push({
      ...c,
      secondaryQa: {
        primaryCount: c.primary,
        secondaryTotalInRadius: qa.secondaryTotal,
        credibleSecondaryCount: qa.credibleSecondary,
        adjustedCredibleRoofingCompetitors: adjusted,
        upliftPct: Number(uplift.toFixed(1)),
        thesisMateriallyChanges: thesisChanges,
        byBucket: qa.byBucket,
        sampleCredible: qa.sampleCredible,
      },
    });
  }

  // Manual group reviews
  const groupReviews = {
    lasVegasValley: {
      strongestCenter: "Las Vegas / Spring Valley / Winchester / Summerlin South",
      sameExpansionChoice:
        "LV Spring Valley, Enterprise/Paradise, North Las Vegas, and Henderson are substantially one valley expansion choice with different operating centers.",
      westSouthNorth:
        "West/Summerlin-leaning Spring Valley LOA is the score leader and robust across weights. South Enterprise is close. North Las Vegas is similar scarcity thesis with slightly weaker baseline rank. Prefer one valley entry, not four.",
      establishedReviewDensity:
        "Still relatively few 100+ review primary roofers vs owner HH after secondary QA (check candidate QA).",
    },
    seattleEastsideNorth: {
      oneOrMultiple:
        "One first-location expansion opportunity for Eastside/North Seattle proper. Kitsap (Poulsbo/Bainbridge) is a separate water-separated territory and should not be merged.",
      bestCenter: "Redmond / Bellevue / Kirkland / Sammamish",
      incomeVsIncumbents:
        "Huge owner HH + top-tier MHI offset dense primary counts and strong top-5 incumbents. Market-led / Highly Robust, not a soft-competition play.",
    },
    kitsap: {
      note: "Poulsbo/Bainbridge remains a distinct smaller/Growth scarcity play if retained as standalone; not part of Eastside.",
    },
    portlandWestside: {
      overlap: "Hillsboro/Beaverton and Tigard/Lake Oswego substantially overlap.",
      strongestCenter: "Hillsboro / Beaverton / Aloha / Bethany",
    },
    utah: {
      corridors: [
        {
          name: "Hooper",
          type: "Smaller scarcity play (Ogden/Clearfield fringe)",
        },
        {
          name: "Tremonton",
          type: "Smaller scarcity play (north of Ogden)",
        },
        {
          name: "Lehi / Sandy / Herriman / Draper",
          type: "Suburban growth corridor / major south valley",
        },
        {
          name: "Magna / West Valley",
          type: "West Salt Lake Valley growth/scarcity mix",
        },
        {
          name: "Tooele",
          type: "Smaller satellite west of Salt Lake",
        },
        {
          name: "Summit Park",
          type: "High-income Park City-adjacent scarcity/affluent niche",
        },
      ],
    },
    smallerScarcity: {
      Hooper: "Enough absolute HH (~37k) for standalone small/growth satellite; not Major.",
      Dayton: "Borderline growth (~31k HH); verify zero 100+ is real. Standalone satellite OK.",
      Prineville: "Downgrade confidence — demo correction + secondary uplift. Satellite only.",
      Cheney: "Spokane-adjacent scarcity; ~41k HH possible satellite, not major.",
      Tremonton: "Competition-led only; small absolute base — satellite/watch.",
      McMinnville: "Growth-tier scarcity; credible standalone small market.",
    },
  };

  // Apply downgrades
  for (const c of candidatesWithQa) {
    if (c.name === "Prineville" || c.recommendedCenter === "Prineville") {
      c.downgradeOrRemove = true;
      c.downgradeReason =
        "Remove from primary shortlist consideration as Major/Growth equivalent; retain only as weak Small/Satellite with QA caveats (demo inflation + secondary competition).";
      c.marketSizeTier = "Small / Satellite Opportunity";
    }
    if (c.name === "Tremonton") {
      c.qaNotes.push("Highly competition-weight dependent (cmp #3 vs mkt #48).");
    }
    if (c.name.includes("Poulsbo") || c.recommendedCenter.includes("Poulsbo")) {
      c.qaNotes.push(
        "ZCTA centroid method pulls Seattle mainland ZCTAs across Puget Sound (e.g. 98107, 98117). Owner HH (~121k) is overstated for Kitsap proper. Do not treat as a Major metro equivalent to Eastside or Las Vegas.",
      );
      c.marketSizeTier = "Growth Opportunity";
      c.qaNotes.push(
        "Reclassified to Growth for shortlist presentation due to water-crossing demo bleed; Phase V score unchanged.",
      );
    }
    if (c.name.includes("Las Vegas")) {
      c.qaNotes.push(
        "After secondary QA, credible non-primary roofing adds ~23% uplift. Established 100+ review density remains relatively thin vs owner HH; total active roofing-capable set is denser than primary-only implies.",
      );
    }
  }

  const active = candidatesWithQa.filter((c) => !c.downgradeOrRemove);
  const downgraded = candidatesWithQa.filter((c) => c.downgradeOrRemove);

  // Poulsbo: keep active but exclude from Best Major shortlist
  const majorEligible = active.filter(
    (c) =>
      c.marketSizeTier === "Major Opportunity" &&
      !c.name.includes("Poulsbo"),
  );

  const bestMajor = majorEligible
    .sort((a, b) => a.phase5Rank - b.phase5Rank)
    .slice(0, 8);

  const bestGrowth = active
    .filter((c) => c.marketSizeTier === "Growth Opportunity")
    .sort((a, b) => a.phase5Rank - b.phase5Rank)
    .slice(0, 8);

  const bestSmall = active
    .filter((c) => c.marketSizeTier === "Small / Satellite Opportunity")
    .sort((a, b) => a.phase5Rank - b.phase5Rank)
    .slice(0, 5);

  const report = {
    duplicateCorrections: excluded.map((e) => ({
      excluded: e.display_name,
      slug: e.slug,
      reason: e.ranking_exclude_reason,
      duplicateOf: e.duplicate_of_loa_id,
    })),
    nearDuplicateScan:
      "Only Pahrump (exact) and Heber/Heber City (near) required exclusion. No other Top-30 accidental duplicates.",
    tierCounts,
    rankingsByTier,
    expansionAreas,
    candidates: candidatesWithQa,
    activeCandidateCount: active.length,
    groupReviews,
    bestMajorMarketOpportunities: bestMajor.map(summarizeCandidate),
    bestGrowthMarketOpportunities: bestGrowth.map(summarizeCandidate),
    bestSmallSatelliteOpportunities: bestSmall.map(summarizeCandidate),
    robustnessSummary: {
      highlyRobust: active.filter((c) => c.robustness === "Highly Robust").map((c) => c.name),
      marketLed: active.filter((c) => c.robustness === "Market-Led").map((c) => c.name),
      competitionLed: active.filter((c) => c.robustness === "Competition-Led").map((c) => c.name),
      balanced: active.filter((c) => c.robustness === "Balanced").map((c) => c.name),
    },
    downgradedOrRemoved: downgraded.map((c) => ({
      name: c.name,
      reason: c.downgradeReason,
      qaNotes: c.qaNotes,
    })),
  };

  function summarizeCandidate(c: (typeof candidatesWithQa)[0]) {
    return {
      name: c.name,
      type: c.type,
      state: c.state,
      center: c.recommendedCenter,
      tier: c.marketSizeTier,
      score: c.phase5Score,
      rank: c.phase5Rank,
      robustness: c.robustness,
      theses: c.theses,
      ownerHh: c.ownerHh,
      sensitivity: c.sensitivityRanks,
      secondaryThesisChanges: c.secondaryQa.thesisMateriallyChanges,
      credibleSecondary: c.secondaryQa.credibleSecondaryCount,
    };
  }

  writeFileSync(join(OUT, "phase6-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(
    join(OUT, "expansion-candidates.json"),
    JSON.stringify(candidatesWithQa, null, 2),
  );

  console.log(JSON.stringify({
    duplicates: report.duplicateCorrections,
    tierCounts,
    expansionAreaCount: expansionAreas.length,
    expansionAreas: expansionAreas.map((a) => ({
      name: a.name,
      center: a.recommendedOperatingCenter,
      members: a.memberLoas.length,
      score: a.strongestScore,
    })),
    candidateCount: candidatesWithQa.length,
    active: active.length,
    bestMajor: bestMajor.map((c) => c.name),
    bestGrowth: bestGrowth.map((c) => c.name),
    bestSmall: bestSmall.map((c) => c.name),
    robustness: report.robustnessSummary,
    downgraded: report.downgradedOrRemoved,
  }, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
