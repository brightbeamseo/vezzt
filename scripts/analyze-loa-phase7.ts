/**
 * Phase VII — Final Master Opportunity Ranking
 * Consolidates eligible LOAs into Expansion Opportunities using Phase VI logic.
 * Does NOT change Phase V Opportunity Scores or weights.
 *
 * Usage: npm run analyze:phase7
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import { createAdminPgPool } from "../src/lib/admin-db";
import { distanceMiles } from "../src/lib/local-opportunity-areas";

config({ path: ".env.local" });

const OUT = join(process.cwd(), "tmp", "phase7");
const PHASE5 = join(process.cwd(), "tmp", "phase5", "phase5-report.json");
const PHASE4 = join(process.cwd(), "tmp", "phase4", "clean-analysis-dataset.json");

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
  ownerOccupiedHouseholds: number | null;
  medianHouseholdIncome: number | null;
  housingGrowth: number | null;
  primaryInRadius: number;
  secondaryInRadius: number;
  reviews100: number;
  reviews250: number;
  reviews500: number;
  reviews1000: number;
  top5ReviewsAvg: number | null;
  reviewsMedian: number | null;
  ownerHhPerPrimary: number | null;
  ownerHhPer100: number | null;
  ownerHhPer250: number | null;
  ownerHhPer500: number | null;
  zctaCodes: string[];
  validForRanking: boolean;
  demoQualityFlag?: string | null;
  demoCorrected?: boolean;
  demoCorrectionMethod?: string | null;
};

type LoaRow = RankRow & Phase4Row & { bucket: string };

function isKitsapLoa(name: string): boolean {
  return /Poulsbo|Bainbridge|Bremerton|Silverdale|Port Orchard|Kitsap/i.test(
    name,
  );
}

/** Named practical territories — prevents mega-chains across distinct corridors. */
function regionBucket(loa: string, state: string, macro: string): string {
  if (isKitsapLoa(loa)) return "kitsap";

  if (
    /Las Vegas|Enterprise|Henderson|North Las Vegas|Summerlin|Paradise|Winchester|Spring Valley/.test(
      loa,
    )
  )
    return "lv-valley";

  if (
    /Redmond|Bellevue|Kirkland|Sammamish|Seattle|Edmonds|Snoqualmie|Issaquah|Shoreline|Bothell|Monroe|Mill Creek|Eastmont|Cottage Lake/.test(
      loa,
    ) &&
    !isKitsapLoa(loa) &&
    state === "Washington"
  )
    return "sea-east-north";

  if (/Everett|Marysville|Lake Stevens/.test(loa) && state === "Washington")
    return "snohomish";

  if (
    /Tacoma|South Hill|Puyallup|Kent|Renton|Auburn|Federal Way|Lakewood|Parkland|Graham|Enumclaw|Bonney Lake/.test(
      loa,
    )
  )
    return "south-sound";

  if (/Lacey|Olympia|Yelm|Tumwater/.test(loa)) return "olympia";

  if (/Hillsboro|Beaverton|Aloha|Bethany|Tigard/.test(loa)) return "pdx-west";
  if (/^Portland \//.test(loa) || /Lake Oswego/.test(loa)) return "pdx-west";
  if (/Gresham|Happy Valley|Milwaukie|Camas/.test(loa)) return "pdx-east";
  if (/Battle Ground|Orchards|Hazel Dell/.test(loa)) return "vancouver-wa";
  if (/St\. Helens/.test(loa)) return "columbia-county-or";

  // Utah: keep corridors separate (order matters)
  if (loa === "Hooper") return "hooper";
  if (/Tremonton|Logan|Brigham/.test(loa)) return "cache-valley";
  if (/Tooele/.test(loa)) return "tooele";
  if (/Summit Park|Park City/.test(loa)) return "summit-park";
  if (/Heber/.test(loa)) return "heber";
  if (
    /Lehi|Eagle Mountain|Saratoga Springs|American Fork|Orem|Provo|Payson|Spanish Fork|Springville|Pleasant Grove|Herriman|Draper/.test(
      loa,
    ) ||
    /^Sandy \//.test(loa) ||
    /Lehi \/ Sandy/.test(loa)
  )
    return "utah-county-south";
  if (
    /Magna|West Jordan|West Valley|Salt Lake City|South Jordan|Millcreek|Murray|Taylorsville/.test(
      loa,
    )
  )
    return "slc-west-central";
  if (
    /Kaysville|Farmington|Ogden|Roy|Clearfield|Clinton|Layton|Syracuse/.test(
      loa,
    )
  )
    return "davis-weber";

  // Spokane: keep Cheney scarcity LOA separate from Spokane core
  if (loa === "Cheney") return "cheney";
  if (/Spokane|Liberty Lake/.test(loa)) return "spokane";

  if (state === "Oregon" && loa === "Prineville") return "prineville";
  if (state === "Oregon" && (loa === "Redmond" || loa === "Bend" || /Redmond|Bend/.test(loa)))
    return "central-oregon";

  // Carson / Tahoe / Dayton: keep Dayton scarcity separate
  if (loa === "Dayton") return "dayton-nv";
  if (/Incline/.test(loa)) return "incline-tahoe";
  if (/Carson|Johnson Lane|Gardnerville/.test(loa)) return "carson-valley";

  if (/Cold Springs|Reno|Sparks|Spanish Springs|Sun Valley/.test(loa))
    return "reno";

  if (/Boise|Meridian|Nampa|Caldwell|Kuna|Eagle/.test(loa)) return "boise-metro";
  if (/Whitefish|Kalispell/.test(loa)) return "flathead";
  if (/Ashland|Medford/.test(loa)) return "rogue-valley";
  if (state === "Utah" && /Hurricane|St\. George|Washington/.test(loa))
    return "st-george";
  if (/Bellingham|Lynden|Birch Bay/.test(loa)) return "whatcom";
  if (/Sweet Home|Lebanon|Albany|Corvallis/.test(loa)) return "mid-willamette";
  if (/Dallas|Stayton|Salem|Keizer|Hayesville/.test(loa)) return "salem";
  // McMinnville stays standalone; Molalla/Woodburn with mid-valley fringe
  if (loa === "McMinnville") return "mcminnville";
  if (/Molalla|Woodburn/.test(loa)) return "willamette-fringe";
  if (/West Richland|Richland|Kennewick|Pasco/.test(loa)) return "tri-cities";
  if (/Laurel|Billings/.test(loa)) return "billings";
  if (/Longview|Kelso/.test(loa)) return "cowlitz";
  if (/Oak Harbor|Anacortes|Mount Vernon|Arlington|Port Townsend|Sedro-Woolley|Camano/.test(loa))
    return `north-sound:${loa.split(" / ")[0]}`;

  return `solo:${state}:${macro}:${loa.split(" / ")[0]}`;
}

function clusterDisplayName(members: LoaRow[], bucket: string): string {
  const best = [...members].sort((a, b) => a.rank - b.rank)[0]!;
  const names: Record<string, string> = {
    "lv-valley": "Las Vegas Valley",
    "sea-east-north": "Seattle Eastside / North",
    "pdx-west": "Portland Westside",
    olympia: "Olympia Area",
    "south-sound": "South Puget Sound",
    kitsap: "Kitsap Peninsula",
    "utah-county-south": "Utah County / South Salt Lake Corridor",
    "slc-west-central": "West / Central Salt Lake Valley",
    "davis-weber": "Davis / Weber County",
    "cache-valley": "Cache Valley",
    "summit-park": "Summit Park",
    heber: "Heber City",
    tooele: "Tooele",
    hooper: "Hooper",
    cheney: "Cheney",
    spokane: "Spokane Area",
    "central-oregon": "Central Oregon (Bend / Redmond)",
    prineville: "Prineville",
    "dayton-nv": "Dayton",
    "incline-tahoe": "Incline Village / Tahoe",
    "carson-valley": "Carson Valley",
    reno: "Reno / Sparks",
    "boise-metro": "Boise Metro",
    flathead: "Flathead Valley",
    "rogue-valley": "Rogue Valley",
    "st-george": "St. George Area",
    whatcom: "Whatcom County",
    "mid-willamette": "Mid-Willamette (Albany / Corvallis)",
    salem: "Salem Area",
    mcminnville: "McMinnville",
    "willamette-fringe": "Willamette Fringe (Woodburn / Molalla)",
    "tri-cities": "Tri-Cities",
    billings: "Billings Area",
    cowlitz: "Longview / Kelso",
    snohomish: "Snohomish County Core",
    "pdx-east": "Portland Eastside",
    "vancouver-wa": "Vancouver WA / Battle Ground",
    "columbia-county-or": "St. Helens",
  };
  if (names[bucket]) return names[bucket]!;
  if (members.length === 1) return best.loa;
  return best.loa;
}

function tierFromOwnerHh(ownerHh: number | null): string {
  if (ownerHh == null) return "unknown";
  if (ownerHh >= 100000) return "Major Opportunity";
  if (ownerHh >= 30000) return "Growth Opportunity";
  if (ownerHh >= 10000) return "Small / Satellite Opportunity";
  return "Watchlist";
}

function quantileThresholds(values: number[], qs: number[]): number[] {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return qs.map(() => 0);
  return qs.map((q) => {
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.floor(q * (sorted.length - 1))),
    );
    return sorted[idx]!;
  });
}

function labelFromBreaks(
  value: number | null,
  breaks: number[],
  labels: string[],
  higherIsStronger: boolean,
): string {
  if (value == null || !Number.isFinite(value)) return labels[Math.floor(labels.length / 2)]!;
  let i = 0;
  while (i < breaks.length && value > breaks[i]!) i++;
  // i is bucket index 0..labels.length-1
  const idx = Math.min(labels.length - 1, i);
  if (higherIsStronger) return labels[idx]!;
  return labels[labels.length - 1 - idx]!;
}

function whyItRanks(o: {
  ownerHh: number | null;
  mhi: number | null;
  housingGrowth: number | null;
  primary: number;
  reviews100: number;
  ownerHhPer100: number | null;
  ownerHhPerPrimary: number | null;
  top5AvgReviews: number | null;
  sizeLabel: string;
  competitionLabel: string;
  establishedLabel: string;
  growthLabel: string;
  tier: string;
}): string {
  const large = (o.ownerHh ?? 0) >= 100000;
  const mid = (o.ownerHh ?? 0) >= 30000;
  const affluent = (o.mhi ?? 0) >= 100000;
  const growthHigh = (o.housingGrowth ?? 0) >= 10;
  const fewEstablished = o.reviews100 <= 5 || (o.ownerHhPer100 ?? 0) >= 25000;
  const densePrimary = o.primary >= 80;
  const strongIncumbents = (o.top5AvgReviews ?? 0) >= 200;
  const weakIncumbents = (o.top5AvgReviews ?? 999) < 80;
  const sparsePrimary = (o.ownerHhPerPrimary ?? 0) >= 2500;

  if (large && fewEstablished && !strongIncumbents)
    return "Large homeowner base with unusually few established roofing competitors.";
  if (large && affluent && (densePrimary || strongIncumbents))
    return "Very affluent market, but strong incumbent roofing brands reduce competitive opportunity.";
  if (large && densePrimary)
    return "Large market, but dense roofing competition limits relative expansion opportunity.";
  if (growthHigh && mid && fewEstablished && weakIncumbents)
    return "Fast-growing mid-size market with almost no established roofing competition.";
  if (growthHigh && !large && fewEstablished)
    return "Fast-growing smaller market with almost no established roofing competition.";
  if (!large && sparsePrimary && fewEstablished)
    return "Smaller market with low roofing density and weak established competitors.";
  if (affluent && strongIncumbents)
    return "High-income area where established roofers already hold strong review presence.";
  if (growthHigh && mid)
    return "Growing homeowner market with moderate roofing competition relative to size.";
  if (large && fewEstablished)
    return "Large homeowner base with relatively thin established roofing competition.";
  if (o.tier.startsWith("Small") && fewEstablished)
    return "Limited absolute homeowner base; ranks on scarcity more than market scale.";
  if (densePrimary)
    return "Substantial homeowner base offset by relatively dense local roofing competition.";
  return "Balanced size, growth, and competition profile versus other eligible markets.";
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  if (!existsSync(PHASE5)) throw new Error("Missing Phase V report");
  if (!existsSync(PHASE4)) throw new Error("Missing Phase IV dataset");

  const phase5 = JSON.parse(readFileSync(PHASE5, "utf8")) as {
    fullRanking: RankRow[];
    smallMarketWatchlist?: Array<Record<string, unknown>>;
  };
  const phase4 = JSON.parse(readFileSync(PHASE4, "utf8")) as Phase4Row[];

  const pool = createAdminPgPool(4);

  // Idempotent duplicate exclusions
  await pool.query(`
    update local_opportunity_areas
    set ranking_excluded = false
    where slug in ('pahrump-nevada-pahrump', 'heber-city-utah-heber-ut');

    update local_opportunity_areas dup
    set
      ranking_excluded = true,
      ranking_exclude_reason = 'Duplicate of Pahrump LOA under dedicated Pahrump macro market. Same ZCTAs; centers ~1.1mi apart.',
      duplicate_of_loa_id = keep.id
    from local_opportunity_areas keep
    where dup.slug = 'pahrump-nevada-las-vegas'
      and keep.slug = 'pahrump-nevada-pahrump';

    update local_opportunity_areas dup
    set
      ranking_excluded = true,
      ranking_exclude_reason = 'Near-duplicate of Heber City LOA (centers 2.75mi, 75% shared ZCTAs).',
      duplicate_of_loa_id = keep.id
    from local_opportunity_areas keep
    where dup.slug = 'heber-utah-salt-lake-city'
      and keep.slug = 'heber-city-utah-heber-ut';
  `);

  const { rows: loaMeta } = await pool.query<{
    id: string;
    display_name: string;
    slug: string;
    ranking_excluded: boolean;
  }>(`select id, display_name, slug, ranking_excluded from local_opportunity_areas`);

  const excludedSlugs = new Set(
    loaMeta.filter((m) => m.ranking_excluded).map((m) => m.slug),
  );
  const p4ByName = new Map(phase4.map((r) => [r.loa, r]));
  const p4ById = new Map(phase4.map((r) => [r.id, r]));

  // Dedupe Phase V ranking by display name; skip excluded
  const seenNames = new Set<string>();
  const eligible: LoaRow[] = [];
  const watchRaw: LoaRow[] = [];

  for (const r of phase5.fullRanking) {
    if (seenNames.has(r.loa)) continue;
    const metas = loaMeta.filter((m) => m.display_name === r.loa);
    if (metas.length && metas.every((m) => m.ranking_excluded)) continue;
    const p4 =
      p4ByName.get(r.loa) ??
      phase4.find(
        (x) =>
          x.loa === r.loa &&
          !excludedSlugs.has(x.slug) &&
          !loaMeta.find((m) => m.id === x.id)?.ranking_excluded,
      );
    if (!p4 || excludedSlugs.has(p4.slug)) continue;
    const meta = loaMeta.find((m) => m.id === p4.id);
    if (meta?.ranking_excluded) continue;

    seenNames.add(r.loa);
    const bucket = regionBucket(r.loa, r.state, r.macroMarket);
    const row: LoaRow = { ...r, ...p4, bucket };
    if ((p4.ownerOccupiedHouseholds ?? 0) >= 10000) eligible.push(row);
    else watchRaw.push(row);
  }

  // Also pull <10k LOAs that may not be in phase5 fullRanking
  for (const p4 of phase4) {
    if (excludedSlugs.has(p4.slug)) continue;
    if ((p4.ownerOccupiedHouseholds ?? 0) >= 10000) continue;
    if (loaMeta.find((m) => m.id === p4.id)?.ranking_excluded) continue;
    if (watchRaw.some((w) => w.id === p4.id) || seenNames.has(p4.loa)) continue;
    const fakeRank: RankRow = {
      rank: 999,
      state: p4.state,
      loa: p4.loa,
      macroMarket: p4.macroMarket,
      opportunityScore: 0,
      ownerHh: p4.ownerOccupiedHouseholds,
      mhi: p4.medianHouseholdIncome,
      housingGrowth: p4.housingGrowth,
      primary: p4.primaryInRadius,
      ownerHhPerPrimary: p4.ownerHhPerPrimary,
      reviews100: p4.reviews100,
      ownerHhPer100: p4.ownerHhPer100,
      top5AvgReviews: p4.top5ReviewsAvg,
      components: {},
      ranksByModel: { baseline: 999, marketHeavy: 999, competitionHeavy: 999 },
      scoresByModel: {},
      secondaryRiskFlag: false,
    };
    // Prefer phase5 score if present under another path — skip if no score
    const p5hit = phase5.fullRanking.find((x) => x.loa === p4.loa);
    if (p5hit) continue;
    watchRaw.push({
      ...fakeRank,
      ...p4,
      bucket: regionBucket(p4.loa, p4.state, p4.macroMarket),
    });
  }

  // --- Cluster eligible LOAs ---
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
  for (const m of eligible) parent.set(m.id, m.id);

  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i]!;
      const b = eligible[j]!;
      if (a.bucket !== b.bucket) continue;
      if (a.bucket.startsWith("solo:") || a.bucket.startsWith("north-sound:"))
        continue;
      if (isKitsapLoa(a.loa) !== isKitsapLoa(b.loa)) continue;

      const dist = distanceMiles(
        { lat: a.centerLat, lng: a.centerLng },
        { lat: b.centerLat, lng: b.centerLng },
      );
      const setA = new Set(a.zctaCodes);
      const setB = new Set(b.zctaCodes);
      const shared = [...setA].filter((z) => setB.has(z)).length;
      const unionN = new Set([...setA, ...setB]).size;
      const pct = unionN ? shared / unionN : 0;
      if (dist <= 16 || pct >= 0.2) union(a.id, b.id);
    }
  }

  // Near-duplicate solos only
  for (let i = 0; i < eligible.length; i++) {
    for (let j = i + 1; j < eligible.length; j++) {
      const a = eligible[i]!;
      const b = eligible[j]!;
      if (find(a.id) === find(b.id)) continue;
      if (!a.bucket.startsWith("solo:") || !b.bucket.startsWith("solo:")) continue;
      if (isKitsapLoa(a.loa) !== isKitsapLoa(b.loa)) continue;
      const dist = distanceMiles(
        { lat: a.centerLat, lng: a.centerLng },
        { lat: b.centerLat, lng: b.centerLng },
      );
      const setA = new Set(a.zctaCodes);
      const setB = new Set(b.zctaCodes);
      const shared = [...setA].filter((z) => setB.has(z)).length;
      const unionN = new Set([...setA, ...setB]).size;
      const pct = unionN ? shared / unionN : 0;
      if (dist <= 12 && pct >= 0.35) union(a.id, b.id);
    }
  }

  const groups = new Map<string, LoaRow[]>();
  for (const m of eligible) {
    const root = find(m.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(m);
  }

  // Distribution breaks among eligible LOAs (for context labels)
  const ownerVals = eligible.map((r) => r.ownerOccupiedHouseholds ?? 0);
  const growthVals = eligible.map((r) => r.housingGrowth ?? 0);
  const primaryVals = eligible.map((r) => r.primaryInRadius);
  const per100Vals = eligible
    .map((r) => r.ownerHhPer100)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const top5Vals = eligible
    .map((r) => r.top5ReviewsAvg)
    .filter((v): v is number => v != null && Number.isFinite(v));

  // Owner HH: Very Large / Large / Mid-Size / Small at ~p75/p50/p25
  const [o25, o50, o75] = quantileThresholds(ownerVals, [0.25, 0.5, 0.75]);
  const [g25, g50, g75] = quantileThresholds(growthVals, [0.25, 0.5, 0.75]);
  const [p25, p50, p75] = quantileThresholds(primaryVals, [0.25, 0.5, 0.75]);
  // Established: use reviews100 count and top5 (higher = stronger incumbents)
  const rev100Vals = eligible.map((r) => r.reviews100);
  const [r25, r50, r75] = quantileThresholds(rev100Vals, [0.25, 0.5, 0.75]);
  const [t25, t50, t75] = quantileThresholds(top5Vals, [0.25, 0.5, 0.75]);

  function sizeLabel(v: number | null) {
    return labelFromBreaks(v, [o25, o50, o75], ["Small", "Mid-Size", "Large", "Very Large"], true);
  }
  function growthLabel(v: number | null) {
    return labelFromBreaks(v, [g25, g50, g75], ["Low", "Moderate", "High", "Very High"], true);
  }
  function competitionLabel(primary: number) {
    // higher primary = more competition
    return labelFromBreaks(
      primary,
      [p25, p50, p75],
      ["Very Low", "Low", "Moderate", "High"],
      true,
    );
  }
  function establishedLabel(reviews100: number, top5: number | null) {
    // Combine: prefer reviews100 intensity; fall back to top5
    const fromCount = labelFromBreaks(
      reviews100,
      [r25, r50, r75],
      ["Very Weak", "Weak", "Moderate", "Strong"],
      true,
    );
    if (reviews100 === 0) return "Very Weak";
    if ((top5 ?? 0) >= (t75 ?? 300) && reviews100 >= (r50 ?? 5)) return "Very Strong";
    if ((top5 ?? 0) >= (t50 ?? 150) && fromCount === "Strong") return "Very Strong";
    return fromCount;
  }

  // Secondary QA classifier (same as Phase VI refined)
  async function secondaryQa(loaIds: string[]) {
    const { rows } = await pool.query<{
      place_id: string;
      title: string | null;
      category_name: string | null;
      categories: string[] | null;
      reviews_count: number | null;
    }>(
      `select distinct on (b.place_id)
         b.place_id, b.title, b.category_name, b.categories, b.reviews_count
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
        return false;
      }
      if (titleRoof) return true;
      if (primary.includes("siding") || primary.includes("exterior")) return true;
      const gcLike =
        primary === "general contractor" ||
        primary === "construction company" ||
        primary === "contractor" ||
        primary === "building firm" ||
        primary === "remodeler" ||
        primary === "custom home builder" ||
        primary === "home builder";
      if (gcLike && catsRoofing) return true;
      if (
        (primary.includes("water damage") || primary.includes("restoration")) &&
        catsRoofing
      )
        return true;
      return false;
    };

    const credible = rows.filter(classify).length;
    return { secondaryTotal: rows.length, credibleSecondary: credible };
  }

  type Opportunity = {
    rank: number;
    expansionOpportunity: string;
    state: string;
    recommendedOperatingCenter: string;
    opportunityTier: string;
    opportunityScore: number;
    ownerOccupiedHouseholds: number | null;
    medianHouseholdIncome: number | null;
    housingGrowthPct: number | null;
    primaryRoofingCompetitors: number;
    credibleSecondaryRoofingCompetitors: number;
    adjustedRoofingCompetitors: number;
    reviews100Primary: number;
    ownerHhPer100: number | null;
    top5AvgReviews: number | null;
    whyItRanks: string;
    sizeLabel: string;
    competitionLabel: string;
    establishedCompetitionLabel: string;
    growthLabel: string;
    // internal
    representativeLoa: string;
    memberLoas: string[];
    memberLoaIds: string[];
    macroMarket: string;
    bucket: string;
    components: Record<string, number>;
    ranksByModel: RankRow["ranksByModel"];
    reviews250: number;
    reviews500: number;
    reviews1000: number;
    reviewsMedian: number | null;
    ownerHhPerPrimary: number | null;
    ownerHhPer250: number | null;
    ownerHhPer500: number | null;
    demographicCaveats: string[];
    secondaryCaveats: string[];
    qaFlags: string[];
  };

  const opportunities: Opportunity[] = [];

  for (const members of groups.values()) {
    const sorted = [...members].sort((a, b) => {
      if (b.opportunityScore !== a.opportunityScore)
        return b.opportunityScore - a.opportunityScore;
      return (b.ownerOccupiedHouseholds ?? 0) - (a.ownerOccupiedHouseholds ?? 0);
    });
    const anchor = sorted[0]!;
    const name = clusterDisplayName(sorted, anchor.bucket);
    const qaFlags: string[] = [];
    const demographicCaveats: string[] = [];
    const secondaryCaveats: string[] = [];

    const maxMemberHh = Math.max(
      ...sorted.map((m) => m.ownerOccupiedHouseholds ?? 0),
    );
    if (
      maxMemberHh > (anchor.ownerOccupiedHouseholds ?? 0) * 1.25 &&
      sorted.length > 1
    ) {
      demographicCaveats.push(
        `Representative LOA HH (${anchor.ownerOccupiedHouseholds}) is below largest member HH (${maxMemberHh}); demographics are not summed.`,
      );
    }

    let tier = tierFromOwnerHh(anchor.ownerOccupiedHouseholds);

    // Phase VI business-context overrides
    if (name.includes("Kitsap") || isKitsapLoa(anchor.loa)) {
      demographicCaveats.push(
        "ZCTA centroids can pull Seattle mainland ZCTAs across Puget Sound; owner HH may be overstated.",
      );
      if (tier === "Major Opportunity") {
        tier = "Growth Opportunity";
        qaFlags.push("Tier overridden to Growth due to cross-water demographic bleed.");
      }
    }
    if (name === "Prineville" || anchor.loa === "Prineville") {
      demographicCaveats.push(
        "Prineville soft-intersect demographics may overstate market size.",
      );
      tier = "Small / Satellite Opportunity";
      qaFlags.push(
        "Prineville: present as Small/Satellite with demo + secondary caveats (Phase VI).",
      );
    }
    if (anchor.demoCorrected) {
      demographicCaveats.push(
        `Demographics corrected via ${anchor.demoCorrectionMethod ?? "Phase IV method"}.`,
      );
    }

    const qa = await secondaryQa(sorted.map((m) => m.id));
    const uplift =
      anchor.primaryInRadius > 0
        ? (qa.credibleSecondary / anchor.primaryInRadius) * 100
        : 0;
    if (uplift >= 20) {
      secondaryCaveats.push(
        `Credible secondary adds ~${uplift.toFixed(0)}% vs primary-only count.`,
      );
    }

    const size = sizeLabel(anchor.ownerOccupiedHouseholds);
    const growth = growthLabel(anchor.housingGrowth);
    const competition = competitionLabel(anchor.primaryInRadius);
    const established = establishedLabel(
      anchor.reviews100,
      anchor.top5ReviewsAvg,
    );

    // States: if multi-state cluster, list unique
    const states = [...new Set(sorted.map((m) => m.state))];

    opportunities.push({
      rank: 0,
      expansionOpportunity: name,
      state: states.join(" / "),
      recommendedOperatingCenter: anchor.loa,
      opportunityTier: tier,
      opportunityScore: anchor.opportunityScore,
      ownerOccupiedHouseholds: anchor.ownerOccupiedHouseholds,
      medianHouseholdIncome: anchor.medianHouseholdIncome,
      housingGrowthPct: anchor.housingGrowth,
      primaryRoofingCompetitors: anchor.primaryInRadius,
      credibleSecondaryRoofingCompetitors: qa.credibleSecondary,
      adjustedRoofingCompetitors: anchor.primaryInRadius + qa.credibleSecondary,
      reviews100Primary: anchor.reviews100,
      ownerHhPer100: anchor.ownerHhPer100,
      top5AvgReviews: anchor.top5ReviewsAvg,
      whyItRanks: "",
      sizeLabel: size,
      competitionLabel: competition,
      establishedCompetitionLabel: established,
      growthLabel: growth,
      representativeLoa: anchor.loa,
      memberLoas: sorted.map((m) => m.loa),
      memberLoaIds: sorted.map((m) => m.id),
      macroMarket: anchor.macroMarket,
      bucket: anchor.bucket,
      components: anchor.components,
      ranksByModel: anchor.ranksByModel,
      reviews250: anchor.reviews250,
      reviews500: anchor.reviews500,
      reviews1000: anchor.reviews1000,
      reviewsMedian: anchor.reviewsMedian,
      ownerHhPerPrimary: anchor.ownerHhPerPrimary,
      ownerHhPer250: anchor.ownerHhPer250,
      ownerHhPer500: anchor.ownerHhPer500,
      demographicCaveats,
      secondaryCaveats,
      qaFlags,
    });
  }

  // Sort by Phase V baseline score of representative; assign ranks
  opportunities.sort((a, b) => {
    if (b.opportunityScore !== a.opportunityScore)
      return b.opportunityScore - a.opportunityScore;
    return (b.ownerOccupiedHouseholds ?? 0) - (a.ownerOccupiedHouseholds ?? 0);
  });
  opportunities.forEach((o, i) => {
    o.rank = i + 1;
    o.whyItRanks = whyItRanks({
      ownerHh: o.ownerOccupiedHouseholds,
      mhi: o.medianHouseholdIncome,
      housingGrowth: o.housingGrowthPct,
      primary: o.primaryRoofingCompetitors,
      reviews100: o.reviews100Primary,
      ownerHhPer100: o.ownerHhPer100,
      ownerHhPerPrimary: o.ownerHhPerPrimary,
      top5AvgReviews: o.top5AvgReviews,
      sizeLabel: o.sizeLabel,
      competitionLabel: o.competitionLabel,
      establishedLabel: o.establishedCompetitionLabel,
      growthLabel: o.growthLabel,
      tier: o.opportunityTier,
    });
  });

  // --- Watchlist (<10k) ---
  // Prefer phase5 smallMarketWatchlist enrichment + all <10k from phase4
  const watchByName = new Map<string, LoaRow>();
  for (const w of watchRaw) watchByName.set(w.loa, w);
  for (const p4 of phase4) {
    if (excludedSlugs.has(p4.slug)) continue;
    if ((p4.ownerOccupiedHouseholds ?? 0) >= 10000) continue;
    if (loaMeta.find((m) => m.id === p4.id)?.ranking_excluded) continue;
    if (!watchByName.has(p4.loa)) {
      watchByName.set(p4.loa, {
        rank: 999,
        state: p4.state,
        loa: p4.loa,
        macroMarket: p4.macroMarket,
        opportunityScore: 0,
        ownerHh: p4.ownerOccupiedHouseholds,
        mhi: p4.medianHouseholdIncome,
        housingGrowth: p4.housingGrowth,
        primary: p4.primaryInRadius,
        ownerHhPerPrimary: p4.ownerHhPerPrimary,
        reviews100: p4.reviews100,
        ownerHhPer100: p4.ownerHhPer100,
        top5AvgReviews: p4.top5ReviewsAvg,
        components: {},
        ranksByModel: { baseline: 999, marketHeavy: 999, competitionHeavy: 999 },
        scoresByModel: {},
        secondaryRiskFlag: false,
        ...p4,
        bucket: regionBucket(p4.loa, p4.state, p4.macroMarket),
      });
    }
  }

  const watchlist = [...watchByName.values()]
    .sort((a, b) => {
      // Descriptive sort: scarcity-friendly then size
      const aScore =
        (a.reviews100 === 0 ? 100 : 0) +
        Math.min(50, (a.ownerHhPerPrimary ?? 0) / 100) +
        (a.housingGrowth ?? 0) +
        (a.ownerOccupiedHouseholds ?? 0) / 500;
      const bScore =
        (b.reviews100 === 0 ? 100 : 0) +
        Math.min(50, (b.ownerHhPerPrimary ?? 0) / 100) +
        (b.housingGrowth ?? 0) +
        (b.ownerOccupiedHouseholds ?? 0) / 500;
      return bScore - aScore;
    })
    .map((w) => {
      const limited: string[] = [];
      const watch: string[] = [];
      if ((w.ownerOccupiedHouseholds ?? 0) < 5000)
        limited.push("Very small absolute homeowner base.");
      else limited.push("Below 10k owner-HH primary ranking floor.");
      if (w.reviews100 === 0) watch.push("No 100+ review primary roofers.");
      if ((w.ownerHhPerPrimary ?? 0) >= 3000)
        watch.push("Low primary density relative to size.");
      if ((w.housingGrowth ?? 0) >= 8) watch.push("Elevated housing growth.");
      if ((w.medianHouseholdIncome ?? 0) >= 85000) watch.push("Above-average income.");
      return {
        market: w.loa,
        state: w.state,
        ownerHh: w.ownerOccupiedHouseholds,
        mhi: w.medianHouseholdIncome,
        housingGrowth: w.housingGrowth,
        primaryRoofers: w.primaryInRadius,
        reviews100: w.reviews100,
        whyWatch: watch.join(" ") || "Limited scale; monitor for growth.",
        whyLimited: limited.join(" "),
        macroMarket: w.macroMarket,
      };
    });

  // --- State summary ---
  const stateNames = [
    "Idaho",
    "Oregon",
    "Washington",
    "Utah",
    "Wyoming",
    "Nevada",
    "Montana",
  ];
  const stateSummary = stateNames.map((state) => {
    const opps = opportunities.filter(
      (o) => o.state === state || o.state.split(" / ").includes(state),
    );
    const scores = opps.map((o) => o.opportunityScore).sort((a, b) => a - b);
    const median =
      scores.length === 0
        ? null
        : scores.length % 2 === 1
          ? scores[(scores.length - 1) / 2]!
          : (scores[scores.length / 2 - 1]! + scores[scores.length / 2]!) / 2;
    const best = opps[0]
      ? [...opps].sort((a, b) => a.rank - b.rank)[0]
      : null;
    return {
      state,
      rankedOpportunities: opps.length,
      highestRanked: best
        ? { rank: best.rank, name: best.expansionOpportunity, score: best.opportunityScore }
        : null,
      medianOpportunityScore: median != null ? Number(median.toFixed(2)) : null,
      major: opps.filter((o) => o.opportunityTier === "Major Opportunity").length,
      growth: opps.filter((o) => o.opportunityTier === "Growth Opportunity").length,
      smallSatellite: opps.filter(
        (o) => o.opportunityTier === "Small / Satellite Opportunity",
      ).length,
    };
  });

  // --- Final QA ---
  const qaWarnings: string[] = [];
  const nameCounts = new Map<string, number>();
  for (const o of opportunities) {
    nameCounts.set(o.expansionOpportunity, (nameCounts.get(o.expansionOpportunity) ?? 0) + 1);
  }
  for (const [n, c] of nameCounts) {
    if (c > 1) qaWarnings.push(`Duplicate expansion opportunity name: ${n} (${c})`);
  }
  const allMembers = opportunities.flatMap((o) => o.memberLoas);
  const memberDup = allMembers.filter((m, i) => allMembers.indexOf(m) !== i);
  if (memberDup.length)
    qaWarnings.push(`LOA appears in multiple opportunities: ${[...new Set(memberDup)].join(", ")}`);

  if (!opportunities.some((o) => o.expansionOpportunity === "Las Vegas Valley"))
    qaWarnings.push("Las Vegas Valley cluster missing.");
  if (!opportunities.some((o) => o.expansionOpportunity === "Seattle Eastside / North"))
    qaWarnings.push("Seattle Eastside / North cluster missing.");

  const pahrumpDup = opportunities.filter((o) =>
    o.memberLoas.some((m) => m === "Pahrump"),
  );
  if (pahrumpDup.length > 1)
    qaWarnings.push("Multiple Pahrump opportunities after exclusion.");

  const heberDup = loaMeta.filter(
    (m) => m.display_name.includes("Heber") && !m.ranking_excluded,
  );
  // ok

  for (const o of opportunities) {
    if (o.qaFlags.length) qaWarnings.push(`Flag ${o.rank} ${o.expansionOpportunity}: ${o.qaFlags.join(" ")}`);
  }

  // Client-facing rows
  const clientTable = opportunities.map((o) => ({
    Rank: o.rank,
    "Expansion Opportunity": o.expansionOpportunity,
    State: o.state,
    "Recommended Operating Center": o.recommendedOperatingCenter,
    "Opportunity Tier": o.opportunityTier,
    "Opportunity Score": o.opportunityScore,
    "Owner-Occupied Households": o.ownerOccupiedHouseholds,
    "Median Household Income": o.medianHouseholdIncome != null
      ? Math.round(o.medianHouseholdIncome)
      : null,
    "Housing Growth %":
      o.housingGrowthPct != null ? Number(o.housingGrowthPct.toFixed(2)) : null,
    "Primary Roofing Competitors": o.primaryRoofingCompetitors,
    "Credible Secondary Roofing Competitors":
      o.credibleSecondaryRoofingCompetitors,
    "Adjusted Roofing Competitors": o.adjustedRoofingCompetitors,
    "100+ Review Primary Roofers": o.reviews100Primary,
    "Owner HH / 100+ Review Roofer":
      o.ownerHhPer100 != null ? Math.round(o.ownerHhPer100) : null,
    "Top-5 Average Reviews":
      o.top5AvgReviews != null ? Number(o.top5AvgReviews.toFixed(1)) : null,
    "Why It Ranks": o.whyItRanks,
    "Size Context": o.sizeLabel,
    "Competition Context": o.competitionLabel,
    "Established Competition Context": o.establishedCompetitionLabel,
    "Growth Context": o.growthLabel,
  }));

  // CSV
  const csvHeaders = Object.keys(clientTable[0] ?? {});
  const internalExtra = [
    "representativeLoa",
    "memberLoas",
    "macroMarket",
    "reviews250",
    "reviews500",
    "reviews1000",
    "reviewsMedian",
    "ownerHhPerPrimary",
    "ownerHhPer250",
    "ownerHhPer500",
    "demographicCaveats",
    "secondaryCaveats",
    "component_ownerHh",
    "component_income",
    "component_housingGrowth",
    "component_primaryScarcity",
    "component_establishedScarcity",
    "component_incumbentStrength",
    "rankBaseline",
    "rankMarketHeavy",
    "rankCompetitionHeavy",
  ];
  const fullCsvHeaders = [...csvHeaders, ...internalExtra];
  const fullCsvRows = opportunities.map((o, i) => {
    const c = clientTable[i]!;
    const base = csvHeaders.map((h) => csvEscape((c as Record<string, unknown>)[h]));
    const extra = [
      o.representativeLoa,
      o.memberLoas.join(" | "),
      o.macroMarket,
      o.reviews250,
      o.reviews500,
      o.reviews1000,
      o.reviewsMedian,
      o.ownerHhPerPrimary,
      o.ownerHhPer250,
      o.ownerHhPer500,
      o.demographicCaveats.join("; "),
      o.secondaryCaveats.join("; "),
      o.components.ownerHh,
      o.components.income,
      o.components.housingGrowth,
      o.components.primaryScarcity,
      o.components.establishedScarcity,
      o.components.incumbentStrength,
      o.ranksByModel.baseline,
      o.ranksByModel.marketHeavy,
      o.ranksByModel.competitionHeavy,
    ].map(csvEscape);
    return [...base, ...extra].join(",");
  });
  const csv =
    fullCsvHeaders.join(",") + "\n" + fullCsvRows.join("\n") + "\n";

  const clientCsvHeaders = csvHeaders;
  const clientCsv =
    clientCsvHeaders.join(",") +
    "\n" +
    clientTable
      .map((row) =>
        clientCsvHeaders
          .map((h) => csvEscape((row as Record<string, unknown>)[h]))
          .join(","),
      )
      .join("\n") +
    "\n";

  const report = {
    summary: {
      consolidatedRankedOpportunities: opportunities.length,
      eligibleLoasInput: eligible.length,
      multiMemberClusters: [...groups.values()].filter((g) => g.length >= 2).length,
      standaloneOpportunities: [...groups.values()].filter((g) => g.length === 1)
        .length,
      watchlistCount: watchlist.length,
      scoringNote:
        "Ranks use Phase V baseline Roofing Expansion Opportunity Score of the representative LOA. No new score.",
    },
    labelBreaks: {
      ownerHh: { p25: o25, p50: o50, p75: o75 },
      housingGrowth: { p25: g25, p50: g50, p75: g75 },
      primary: { p25: p25, p50: p50, p75: p75 },
      reviews100: { p25: r25, p50: r50, p75: r75 },
      top5Avg: { p25: t25, p50: t50, p75: t75 },
      ownerHhPer100Sample: per100Vals.length,
    },
    masterRanking: opportunities,
    clientTable,
    watchlist,
    stateSummary,
    qaWarnings,
  };

  writeFileSync(join(OUT, "phase7-report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(OUT, "master-ranking.csv"), csv);
  writeFileSync(join(OUT, "master-ranking-client.csv"), clientCsv);
  writeFileSync(
    join(OUT, "watchlist.csv"),
    [
      "Market,State,Owner HH,MHI,Housing Growth %,Primary Roofers,100+ Roofers,Why Watch,Why Limited",
      ...watchlist.map((w) =>
        [
          w.market,
          w.state,
          w.ownerHh,
          w.mhi != null ? Math.round(w.mhi) : "",
          w.housingGrowth != null ? Number(w.housingGrowth.toFixed(2)) : "",
          w.primaryRoofers,
          w.reviews100,
          w.whyWatch,
          w.whyLimited,
        ]
          .map(csvEscape)
          .join(","),
      ),
    ].join("\n") + "\n",
  );

  console.log(
    JSON.stringify(
      {
        consolidatedRankedOpportunities: opportunities.length,
        watchlist: watchlist.length,
        multiMember: report.summary.multiMemberClusters,
        top10: opportunities.slice(0, 10).map((o) => ({
          rank: o.rank,
          name: o.expansionOpportunity,
          score: o.opportunityScore,
          tier: o.opportunityTier,
          why: o.whyItRanks,
        })),
        stateSummary,
        qaWarningCount: qaWarnings.length,
        qaWarnings: qaWarnings.slice(0, 20),
        exports: [
          "tmp/phase7/master-ranking.csv",
          "tmp/phase7/master-ranking-client.csv",
          "tmp/phase7/watchlist.csv",
          "tmp/phase7/phase7-report.json",
        ],
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
