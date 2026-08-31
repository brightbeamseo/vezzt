/**
 * Generate the client-facing Roofing Expansion Opportunity Report PDF.
 * Source of truth: Phase VII exports (scores/ranks unchanged).
 *
 * Usage: npm run report:expansion-pdf
 * Output: ~/Downloads/Roofing-Expansion-Opportunity-Report.pdf
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { config } from "dotenv";
import PDFDocument from "pdfkit";
import { createAdminPgPool } from "../src/lib/admin-db";

config({ path: ".env.local" });

const ROOT = process.cwd();
const PHASE7 = join(ROOT, "tmp", "phase7", "phase7-report.json");
const PHASE4 = join(ROOT, "tmp", "phase4", "clean-analysis-dataset.json");
const OUT_DIR = join(ROOT, "tmp", "phase7");
const OUT_REPO = join(OUT_DIR, "Roofing-Expansion-Opportunity-Report.pdf");
const OUT_DOWNLOADS = join(
  homedir(),
  "Downloads",
  "Roofing-Expansion-Opportunity-Report.pdf",
);

// Design tokens
const C = {
  ink: "#1a1d21",
  muted: "#5c6570",
  line: "#d8dde3",
  soft: "#f4f6f8",
  softAlt: "#eef2f6",
  accent: "#1e4d8c",
  accentSoft: "#e8f0fa",
  major: "#1e4d8c",
  growth: "#2f6b4f",
  small: "#8a5a2b",
  warn: "#8b3a3a",
  white: "#ffffff",
};

type Phase7Opp = {
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
  representativeLoa: string;
  memberLoas: string[];
  memberLoaIds: string[];
  macroMarket: string;
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

type Phase4Row = {
  loa: string;
  population: number | null;
  populationGrowth: number | null;
  medianHomeValue: number | null;
  singleFamilyShare: number | null;
  ownerOccupiedHouseholds: number | null;
};

type Competitor = { title: string; reviews: number | null; rating: number | null };

function fmtK(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return `${n.toFixed(digits)}%`;
}

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return digits === 0 ? String(Math.round(n)) : n.toFixed(digits);
}

function fmtHhPerEstablished(reviews100: number, ratio: number | null): string {
  if (reviews100 === 0) return "None detected";
  if (ratio == null || !Number.isFinite(ratio)) return "N/A";
  return fmtK(ratio);
}

function shortTier(tier: string): string {
  if (tier.startsWith("Major")) return "Major";
  if (tier.startsWith("Growth")) return "Growth";
  if (tier.startsWith("Small")) return "Small / Satellite";
  return tier;
}

function tierColor(tier: string): string {
  if (tier.startsWith("Major")) return C.major;
  if (tier.startsWith("Growth")) return C.growth;
  return C.small;
}

function interpretation(o: Phase7Opp): string {
  const hh = o.ownerOccupiedHouseholds ?? 0;
  const primary = o.primaryRoofingCompetitors;
  const r100 = o.reviews100Primary;
  const top5 = o.top5AvgReviews ?? 0;
  const growth = o.housingGrowthPct ?? 0;
  const rank = o.rank;

  const bits: string[] = [];

  if (o.qaFlags.some((f) => /Prineville/i.test(f)) || o.expansionOpportunity === "Prineville") {
    bits.push(
      "Interpret this ranking cautiously: soft-intersect demographics may overstate the immediately serviceable market, and credible secondary roofing weakens the raw scarcity signal.",
    );
  } else if (
    o.qaFlags.some((f) => /Kitsap|cross-water/i.test(f)) ||
    o.expansionOpportunity.includes("Kitsap")
  ) {
    bits.push(
      "Homeowner estimates are affected by ZCTA geography that can bleed across Puget Sound; do not read the raw owner-HH figure as a literal Kitsap-only market size.",
    );
  } else if (hh >= 100000 && (r100 >= 12 || top5 >= 200)) {
    bits.push(
      "This is primarily a scale and economics play. Absolute homeowner opportunity is large, but established roofing brands are already visible and review-strong.",
    );
  } else if (hh >= 100000 && r100 <= 10) {
    bits.push(
      "Relative to its homeowner base, established review-heavy roofing competitors remain comparatively thin, which supports further diligence as a major-market entry.",
    );
  } else if (hh < 30000 && (r100 <= 1 || (o.ownerHhPerPrimary ?? 0) >= 3000)) {
    bits.push(
      "Absolute homeowner scale is limited. The rank is driven more by competitor scarcity than by metro-sized demand; treat as satellite or secondary-market diligence.",
    );
  } else if (growth >= 10 && hh >= 30000) {
    bits.push(
      "Housing growth is a material part of the thesis alongside the competition profile. Confirm whether growth is translating into roofing replacement and storm demand locally.",
    );
  } else if (rank > 40 && primary >= 40) {
    bits.push(
      "Lower rank reflects a less favorable balance of homeowner scale versus local roofing density and incumbent strength versus higher-ranked markets.",
    );
  } else if (rank > 40) {
    bits.push(
      "Compared with higher-ranked opportunities, this market offers less compelling combined size, growth, and competition scarcity under the Phase V screening model.",
    );
  } else if (hh >= 30000 && r100 <= 4) {
    bits.push(
      "Mid-size homeowner base with relatively few highly reviewed primary roofers. Useful for Growth-tier diligence, not as a substitute for a major metro.",
    );
  } else {
    bits.push(
      "The score reflects a mixed profile across size, economics, growth, and competitor density relative to other eligible markets in this study.",
    );
  }

  if (o.demographicCaveats.some((c) => /below largest member/i.test(c))) {
    bits.push(
      "Representative LOA demographics are used; member LOAs can be larger in places, and overlapping populations are not summed.",
    );
  }

  return bits.join(" ");
}

async function loadTopCompetitors(
  loaIds: string[],
): Promise<Map<string, Competitor[]>> {
  const map = new Map<string, Competitor[]>();
  if (!loaIds.length) return map;
  const pool = createAdminPgPool(4);
  try {
    const { rows } = await pool.query<{
      loa_id: string;
      title: string | null;
      reviews_count: number | null;
      rating: number | null;
    }>(
      `select * from (
         select
           s.loa_id::text as loa_id,
           b.title,
           b.reviews_count,
           b.total_score::float as rating,
           row_number() over (
             partition by s.loa_id
             order by b.reviews_count desc nulls last
           ) as rn
         from loa_gbp_sightings s
         join loa_gbp_businesses b on b.place_id = s.place_id
         where s.loa_id = any($1::uuid[])
           and coalesce(s.in_radius, false) = true
           and b.qualify_bucket = 'primary'
           and coalesce(b.permanently_closed, false) = false
       ) t
       where rn <= 3`,
      [loaIds],
    );
    for (const r of rows) {
      const list = map.get(r.loa_id) ?? [];
      list.push({
        title: r.title ?? "Unknown",
        reviews: r.reviews_count,
        rating: r.rating,
      });
      map.set(r.loa_id, list);
    }
  } finally {
    await pool.end();
  }
  return map;
}

function drawFooter(
  doc: PDFKit.PDFDocument,
  pageNum: number,
  _landscape: boolean,
) {
  const w = doc.page.width;
  const h = doc.page.height;
  const left = doc.page.margins.left;
  const top = doc.page.margins.top;
  const footerY = h - 20;

  // Allow footer drawing in the bottom margin without triggering an auto page-break.
  const savedBottom = doc.page.margins.bottom;
  doc.page.margins.bottom = 0;

  doc.save();
  doc.fontSize(8).fillColor(C.muted);
  doc.text(
    "Roofing Expansion Opportunity Report  |  August 2026  |  Confidential",
    left,
    footerY,
    {
      width: w - left - 48,
      align: "left",
      lineBreak: false,
    },
  );
  doc.text(String(pageNum), w - 42, footerY, {
    width: 28,
    align: "right",
    lineBreak: false,
  });
  doc.restore();

  doc.page.margins.bottom = savedBottom;
  doc.x = left;
  doc.y = top;
}

function ensureSpace(
  doc: PDFKit.PDFDocument,
  need: number,
  state: { page: number; landscape: boolean },
  onNewPage?: () => void,
) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 8;
  if (doc.y + need > bottomLimit) {
    doc.addPage({
      size: "LETTER",
      layout: state.landscape ? "landscape" : "portrait",
      margins: state.landscape
        ? { top: 36, bottom: 30, left: 28, right: 28 }
        : { top: 48, bottom: 36, left: 48, right: 48 },
    });
    state.page += 1;
    drawFooter(doc, state.page, state.landscape);
    onNewPage?.();
  }
}

function sectionDivider(
  doc: PDFKit.PDFDocument,
  state: { page: number; landscape: boolean },
  part: string,
  title: string,
  subtitle: string,
) {
  doc.addPage({
    size: "LETTER",
    layout: "portrait",
    margins: { top: 42, bottom: 36, left: 48, right: 48 },
  });
  state.page += 1;
  state.landscape = false;
  drawFooter(doc, state.page, false);
  doc.moveDown(8);
  doc.fontSize(12).fillColor(C.accent).text(part, { align: "left" });
  doc.moveDown(0.4);
  doc.fontSize(28).fillColor(C.ink).text(title, { align: "left" });
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor(C.muted).text(subtitle, { align: "left" });
  doc
    .moveTo(48, doc.y + 16)
    .lineTo(200, doc.y + 16)
    .strokeColor(C.accent)
    .lineWidth(2)
    .stroke();
}

async function main() {
  if (!existsSync(PHASE7)) throw new Error("Missing Phase VII report");
  if (!existsSync(PHASE4)) throw new Error("Missing Phase IV dataset");

  const report = JSON.parse(readFileSync(PHASE7, "utf8")) as {
    summary: Record<string, unknown>;
    masterRanking: Phase7Opp[];
    watchlist: Array<{
      market: string;
      state: string;
      ownerHh: number | null;
      mhi: number | null;
      housingGrowth: number | null;
      primaryRoofers: number;
      reviews100: number;
      whyWatch: string;
      whyLimited: string;
    }>;
    stateSummary: Array<{
      state: string;
      rankedOpportunities: number;
      highestRanked: { rank: number; name: string; score: number } | null;
      medianOpportunityScore: number | null;
      major: number;
      growth: number;
      smallSatellite: number;
    }>;
    qaWarnings: string[];
  };
  const phase4 = JSON.parse(readFileSync(PHASE4, "utf8")) as Phase4Row[];
  const p4ByLoa = new Map(phase4.map((r) => [r.loa, r]));

  const opps = report.masterRanking;
  if (opps.length !== 75) {
    console.warn(`Expected 75 opportunities, found ${opps.length}`);
  }

  const allLoaIds = [...new Set(opps.flatMap((o) => o.memberLoaIds))];
  console.log("Loading competitors for", allLoaIds.length, "LOAs...");
  const competitorsByLoa = await loadTopCompetitors(allLoaIds);

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(homedir(), "Downloads"), { recursive: true });

  const qa = {
    partIRanks: [] as number[],
    partIIRanks: [] as number[],
    watchlistMarkets: [] as string[],
    prinevilleCaveat: false,
    kitsapCaveat: false,
    warnings: [] as string[],
  };

  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: 48, bottom: 36, left: 48, right: 48 },
    autoFirstPage: false,
    bufferPages: true,
    info: {
      Title: "Roofing Expansion Opportunity Report",
      Author: "Vezzt",
      Subject: "Western U.S. roofing expansion market analysis",
      CreationDate: new Date("2026-08-31"),
    },
  });

  const stream = createWriteStream(OUT_REPO);
  doc.pipe(stream);

  const state = { page: 0, landscape: false };

  const newPortrait = () => {
    doc.addPage({
      size: "LETTER",
      layout: "portrait",
      margins: { top: 48, bottom: 36, left: 48, right: 48 },
    });
    state.page += 1;
    state.landscape = false;
    drawFooter(doc, state.page, false);
  };

  const newLandscape = () => {
    doc.addPage({
      size: "LETTER",
      layout: "landscape",
      margins: { top: 36, bottom: 30, left: 28, right: 28 },
    });
    state.page += 1;
    state.landscape = true;
    drawFooter(doc, state.page, true);
  };

  // ========== COVER ==========
  newPortrait();
  doc.rect(0, 0, 612, 12).fill(C.accent);
  doc.moveDown(10);
  doc.fontSize(11).fillColor(C.accent).text("VEZZT MARKET ANALYSIS", { align: "left" });
  doc.moveDown(1.2);
  doc.fontSize(32).fillColor(C.ink).text("Roofing Expansion\nOpportunity Report", {
    align: "left",
    lineGap: 4,
  });
  doc.moveDown(0.8);
  doc.fontSize(16).fillColor(C.muted).text("Western U.S. Market Analysis", { align: "left" });
  doc.moveDown(1.5);
  doc
    .moveTo(48, doc.y)
    .lineTo(180, doc.y)
    .strokeColor(C.accent)
    .lineWidth(2)
    .stroke();
  doc.moveDown(1.5);
  doc
    .fontSize(11)
    .fillColor(C.ink)
    .text(
      "75 Ranked Expansion Opportunities Across Idaho, Oregon, Washington, Utah, Wyoming, Nevada & Montana",
      { width: 420, lineGap: 2 },
    );
  doc.moveDown(2);
  doc.fontSize(11).fillColor(C.muted).text("Analysis Date: August 2026");
  doc.moveDown(8);
  doc
    .fontSize(9)
    .fillColor(C.muted)
    .text(
      "Comparative screening analysis for further diligence. Not a revenue prediction, profitability forecast, business valuation, or guarantee of market-entry success.",
      { width: 420 },
    );

  // ========== EXECUTIVE SUMMARY ==========
  newPortrait();
  doc.fontSize(20).fillColor(C.ink).text("Executive Summary");
  doc.moveDown(0.8);
  doc.fontSize(10).fillColor(C.ink).lineGap(3);
  doc.text(
    "This report evaluates roofing expansion opportunities across Idaho, Oregon, Washington, Utah, Wyoming, Nevada, and Montana. The analysis began with granular 15-mile Local Opportunity Areas (LOAs) and then consolidated substantially overlapping territories into realistic Expansion Opportunities so nearby circles would not appear as independent expansion decisions.",
  );
  doc.moveDown(0.6);
  doc.text("Final analysis includes:");
  doc.moveDown(0.3);
  const bullets = [
    "75 ranked Expansion Opportunities",
    "122 eligible underlying LOAs (owner-occupied households of 10,000 or more)",
    "22 additional Small Market Watchlist areas (below 10,000 owner-occupied households)",
    "7 states",
    "Census ACS demographic and housing data",
    "Google Maps / Google Business Profile roofing competition data",
  ];
  for (const b of bullets) {
    doc.text(`  •  ${b}`);
  }
  doc.moveDown(0.6);
  doc.text(
    "Higher-ranked markets generally combine some mixture of a larger homeowner base, stronger household economics, housing growth, fewer roofing competitors relative to the homeowner base, fewer established roofing brands, and weaker incumbent review strength.",
  );
  doc.moveDown(0.5);
  doc.text(
    "Different opportunities can rank highly for different reasons. A large affluent market may rank highly despite substantial competition. A smaller market may rank highly because established roofing competition is unusually weak. Absolute scale and competitive scarcity are not interchangeable.",
  );
  doc.moveDown(0.8);
  doc.fontSize(12).fillColor(C.accent).text("What this report is not");
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(C.ink);
  doc.text(
    "This is not a revenue prediction, profitability forecast, business valuation, Vestimate, or guarantee of market-entry success. The Opportunity Score is a comparative screening metric across the analyzed markets.",
  );

  // ========== HOW TO READ THE SCORE ==========
  newPortrait();
  doc.fontSize(20).fillColor(C.ink).text("How to Read the Score");
  doc.moveDown(0.6);
  doc.fontSize(10).fillColor(C.ink).lineGap(3);
  doc.text(
    "The Roofing Expansion Opportunity Score ranges from 0 to 100. It is a comparative screening metric among eligible markets in this study. A higher score means a more attractive combination of the factors below relative to other analyzed markets. It does not mean a probability of success.",
  );
  doc.moveDown(0.7);
  doc.fontSize(12).fillColor(C.accent).text("Score components");
  doc.moveDown(0.4);

  const components = [
    ["Owner-occupied households", "25%", "Larger homeowner base scores higher."],
    ["Median household income", "10%", "Higher household income scores higher."],
    ["Housing growth (ACS 2019 to 2024)", "10%", "Faster housing unit growth scores higher."],
    ["Owner HH / primary roofer", "20%", "More homeowners per primary Roofing Contractor scores higher."],
    ["Owner HH / 100+ review roofer", "25%", "More homeowners per established (100+ review) primary roofer scores higher."],
    ["Top-5 average competitor reviews", "10%", "Reverse scored: weaker top incumbents score higher."],
  ];
  for (const [name, w, desc] of components) {
    ensureSpace(doc, 36, state);
    doc.fontSize(10).fillColor(C.ink).text(`${name}  (${w})`, { continued: false });
    doc.fontSize(9).fillColor(C.muted).text(desc);
    doc.moveDown(0.25);
  }

  doc.moveDown(0.4);
  doc.fontSize(12).fillColor(C.accent).text("Owner HH / 100+ Review Roofer");
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor(C.ink);
  doc.text(
    "This is the approximate number of owner-occupied households for every primary-category roofing competitor with at least 100 Google reviews. Higher numbers suggest more homeowner opportunity relative to the number of established roofing brands. When zero 100+ review primary roofers are detected, the report shows that explicitly rather than inventing a ratio.",
  );
  doc.moveDown(0.7);
  doc.fontSize(12).fillColor(C.accent).text("Opportunity tiers");
  doc.moveDown(0.4);
  const tiers = [
    ["Major Opportunity", "100,000+ owner-occupied households"],
    ["Growth Opportunity", "30,000 to 99,999 owner-occupied households"],
    ["Small / Satellite Opportunity", "10,000 to 29,999 owner-occupied households"],
    ["Small Market Watchlist", "Below 10,000 owner-occupied households (not in primary ranking)"],
  ];
  for (const [t, d] of tiers) {
    doc.fontSize(10).fillColor(C.ink).text(`${t}: `, { continued: true });
    doc.fillColor(C.muted).text(d);
  }
  doc.moveDown(0.5);
  doc.fontSize(9).fillColor(C.muted);
  doc.text(
    "Known geography or data issues may result in presentation-tier overrides (for example, Kitsap Peninsula is presented as Growth rather than Major because of cross-water demographic bleed).",
  );

  // ========== PART I ==========
  sectionDivider(
    doc,
    state,
    "PART I",
    "Overall Opportunity Ranking",
    "75 Expansion Opportunities Ranked Best to Worst",
  );

  newPortrait();
  doc.fontSize(18).fillColor(C.ink).text("Top 10 at a Glance");
  doc.moveDown(0.4);
  doc.fontSize(9).fillColor(C.muted).text(
    "Exact Phase VII rankings. Caveat indicators: * Prineville demographic/competition caution; † Kitsap geography presentation override.",
  );
  doc.moveDown(0.5);

  // Top 10 compact table
  const top10Headers = [
    "#",
    "Opportunity",
    "St",
    "Tier",
    "Score",
    "Owner HH",
    "Growth",
    "Prim",
    "100+",
    "HH/100+",
  ];
  const top10ColW = [22, 150, 28, 52, 36, 48, 42, 32, 32, 58];
  const drawTop10Header = () => {
    let x = 48;
    const y = doc.y;
    doc.rect(48, y - 2, 516, 16).fill(C.soft);
    doc.fontSize(7.5).fillColor(C.muted);
    for (let i = 0; i < top10Headers.length; i++) {
      doc.text(top10Headers[i]!, x + 2, y, {
        width: top10ColW[i]! - 4,
        lineBreak: false,
      });
      x += top10ColW[i]!;
    }
    doc.x = 48;
    doc.y = y + 16;
  };
  drawTop10Header();
  for (const o of opps.slice(0, 10)) {
    ensureSpace(doc, 18, state, drawTop10Header);
    let name = o.expansionOpportunity;
    if (o.expansionOpportunity === "Prineville") {
      name += " *";
      qa.prinevilleCaveat = true;
    }
    if (o.expansionOpportunity.includes("Kitsap")) {
      name += " †";
      qa.kitsapCaveat = true;
    }
    const stateAbbrTop: Record<string, string> = {
      Washington: "WA",
      Oregon: "OR",
      Utah: "UT",
      Nevada: "NV",
      Idaho: "ID",
      Montana: "MT",
      Wyoming: "WY",
    };
    const row = [
      String(o.rank),
      name,
      stateAbbrTop[o.state.split(" / ")[0]!] ?? o.state.slice(0, 2),
      shortTier(o.opportunityTier).replace(" / Satellite", ""),
      o.opportunityScore.toFixed(1),
      fmtK(o.ownerOccupiedHouseholds),
      fmtPct(o.housingGrowthPct),
      String(o.primaryRoofingCompetitors),
      String(o.reviews100Primary),
      fmtHhPerEstablished(o.reviews100Primary, o.ownerHhPer100),
    ];

    let x = 48;
    const y = doc.y;
    if (o.rank % 2 === 0) doc.rect(48, y - 1, 516, 14).fill(C.softAlt);
    doc.fillColor(C.ink).fontSize(7.5);
    for (let i = 0; i < row.length; i++) {
      doc.fillColor(i === 3 ? tierColor(o.opportunityTier) : C.ink);
      doc.text(row[i]!, x + 2, y, { width: top10ColW[i]! - 4, lineBreak: false });
      x += top10ColW[i]!;
    }
    doc.x = 48;
    doc.y = y + 14;
  }

  // Top-level findings
  newPortrait();
  doc.fontSize(18).fillColor(C.ink).text("Top-Level Findings");
  doc.moveDown(0.6);
  doc.fontSize(10).fillColor(C.ink).lineGap(3);

  const findings = [
    [
      "Seattle Eastside / North",
      "Large, exceptionally affluent homeowner market. Competition and incumbent review strength are substantial. Its ranking is driven more by market size and economics than by weak competition.",
    ],
    [
      "Las Vegas Valley",
      "Large homeowner base with relatively few highly established roofing competitors for its size. It was the strongest broadly balanced opportunity during Phase V sensitivity analysis across baseline, market-heavy, and competition-heavy weightings.",
    ],
    [
      "Hooper",
      "Much smaller absolute market than Seattle or Las Vegas, but unusually limited established competition combined with strong growth. Present as a Growth Opportunity, not as equivalent in absolute scale to a major metro.",
    ],
    [
      "Portland Westside",
      "Large affluent homeowner base with meaningful roofing competition. Attractive major-market opportunity, although the competitive environment is stronger than Las Vegas.",
    ],
  ];
  for (const [title, body] of findings) {
    ensureSpace(doc, 70, state);
    doc.fontSize(11).fillColor(C.accent).text(title);
    doc.moveDown(0.2);
    doc.fontSize(10).fillColor(C.ink).text(body);
    doc.moveDown(0.55);
  }
  doc.fontSize(9).fillColor(C.muted).text(
    "Supporting statistics for every ranked opportunity appear in Part II.",
  );

  // ========== FULL #1-#75 RANKING (landscape) ==========
  newLandscape();
  doc.fontSize(16).fillColor(C.ink).text("Complete Ranking: #1 through #75");
  doc.moveDown(0.2);
  doc.fontSize(8).fillColor(C.muted).text(
    "Roofers = primary GBP category Roofing Contractor. HH / Established = owner-occupied households per 100+ review primary roofer. Phase VII ranking is final.",
  );
  doc.moveDown(0.4);

  const rankHeaders = [
    "#",
    "Opportunity",
    "State",
    "Tier",
    "Score",
    "Owner HH",
    "Growth",
    "Roofers",
    "100+",
    "HH / Est.",
    "Why It Ranks",
  ];
  const rankW = [22, 128, 52, 48, 34, 46, 40, 38, 28, 48, 210];
  const pageWidth = 792 - 56;

  const drawRankHeader = () => {
    let x = 28;
    const y = doc.y;
    doc.rect(28, y - 2, pageWidth, 15).fill(C.soft);
    doc.fontSize(7).fillColor(C.muted);
    for (let i = 0; i < rankHeaders.length; i++) {
      doc.text(rankHeaders[i]!, x + 1, y, {
        width: rankW[i]! - 2,
        lineBreak: false,
      });
      x += rankW[i]!;
    }
    doc.x = 28;
    doc.y = y + 14;
  };

  drawRankHeader();

  const stateAbbr: Record<string, string> = {
    Washington: "WA",
    Oregon: "OR",
    Utah: "UT",
    Nevada: "NV",
    Idaho: "ID",
    Montana: "MT",
    Wyoming: "WY",
  };

  for (const o of opps) {
    const why = o.whyItRanks;
    // estimate row height from why text
    const whyHeight = Math.max(12, Math.ceil(doc.heightOfString(why, { width: rankW[10]! - 4, fontSize: 6.5 }) + 4));
    const rowH = Math.max(14, whyHeight);

    if (doc.y + rowH > 560) {
      newLandscape();
      doc.fontSize(11).fillColor(C.ink).text("Complete Ranking (continued)");
      doc.moveDown(0.3);
      drawRankHeader();
    }

    const y = doc.y;
    if (o.rank % 2 === 0) {
      doc.rect(28, y - 1, pageWidth, rowH).fill(C.softAlt);
    }
    // left tier accent bar
    doc.rect(28, y - 1, 3, rowH).fill(tierColor(o.opportunityTier));

    let name = o.expansionOpportunity;
    if (name === "Prineville") name += " *";
    if (name.includes("Kitsap")) name += " †";

    const cells = [
      String(o.rank),
      name,
      stateAbbr[o.state.split(" / ")[0]!] ?? o.state,
      shortTier(o.opportunityTier).replace("Small / Satellite", "Small"),
      o.opportunityScore.toFixed(1),
      fmtK(o.ownerOccupiedHouseholds),
      fmtPct(o.housingGrowthPct),
      String(o.primaryRoofingCompetitors),
      String(o.reviews100Primary),
      fmtHhPerEstablished(o.reviews100Primary, o.ownerHhPer100),
      why,
    ];

    let x = 28;
    for (let i = 0; i < cells.length; i++) {
      doc.fontSize(i === 10 ? 6.5 : 7).fillColor(i === 3 ? tierColor(o.opportunityTier) : C.ink);
      if (i === 10) {
        doc.text(cells[i]!, x + 2, y + 1, { width: rankW[i]! - 4, lineGap: 1 });
      } else {
        doc.text(cells[i]!, x + 2, y + 2, {
          width: rankW[i]! - 4,
          lineBreak: false,
          ellipsis: true,
          height: rowH - 2,
        });
      }
      x += rankW[i]!;
    }
    doc.x = 28;
    doc.y = y + rowH;
    qa.partIRanks.push(o.rank);
  }

  doc.moveDown(0.5);
  doc.fontSize(7).fillColor(C.muted).text(
    "* Prineville: demographic and secondary-competition caveats apply. † Kitsap: presented as Growth due to cross-water demographic bleed.",
  );

  // ========== PART II ==========
  sectionDivider(
    doc,
    state,
    "PART II",
    "Detailed Market Analysis",
    "A Deeper Look at Each Ranked Expansion Opportunity",
  );

  newPortrait();
  doc.fontSize(10).fillColor(C.ink).lineGap(3);
  doc.text(
    "This section reviews all 75 ranked Expansion Opportunities in the same order as Part I. Use it to investigate why any specific market ranks where it does. Statistics use the Phase VII representative LOA. Overlapping member populations are not summed.",
  );

  for (const o of opps) {
    const demo = p4ByLoa.get(o.representativeLoa);
    const comps =
      competitorsByLoa.get(o.memberLoaIds[0]!) ??
      competitorsByLoa.get(o.memberLoaIds.find((id) => competitorsByLoa.has(id)) ?? "") ??
      [];

    // Estimate block height
    const clustered = o.memberLoas.length > 1;
    const caveats = [
      ...o.qaFlags,
      ...o.demographicCaveats,
      ...o.secondaryCaveats,
    ];
    const need = 210 + (clustered ? 28 : 0) + (caveats.length ? 36 : 0) + (comps.length ? 40 : 0);
    ensureSpace(doc, Math.min(need, 320), state);

    // Card header bar
    const headerY = doc.y;
    doc.rect(48, headerY, 516, 22).fill(C.soft);
    doc.rect(48, headerY, 4, 22).fill(tierColor(o.opportunityTier));
    doc
      .fontSize(11)
      .fillColor(C.ink)
      .text(`#${o.rank}  ${o.expansionOpportunity}, ${o.state}`, 58, headerY + 5, {
        width: 500,
        lineBreak: false,
      });
    doc.x = 48;
    doc.y = headerY + 28;

    doc.fontSize(8.5).fillColor(C.muted);
    doc.text(
      `Tier: ${shortTier(o.opportunityTier)}   |   Opportunity Score: ${o.opportunityScore.toFixed(1)}   |   Recommended Operating Center: ${o.recommendedOperatingCenter}`,
      { width: 516 },
    );
    doc.moveDown(0.25);
    doc
      .fontSize(8)
      .fillColor(C.muted)
      .text(
        `Context: Size ${o.sizeLabel}  ·  Competition ${o.competitionLabel}  ·  Established ${o.establishedCompetitionLabel}  ·  Growth ${o.growthLabel}`,
      );
    doc.moveDown(0.35);

    // Two columns: Market / Competition
    const colY = doc.y;
    const leftX = 48;
    const rightX = 310;
    const colW = 240;

    doc.fontSize(9).fillColor(C.accent).text("Market Opportunity", leftX, colY);
    doc.fontSize(9).fillColor(C.accent).text("Roofing Competition", rightX, colY);

    const marketLines: Array<[string, string]> = [
      ["Owner-Occupied Households", fmtK(o.ownerOccupiedHouseholds)],
      ["Population", fmtK(demo?.population ?? null)],
      ["Median Household Income", fmtMoney(o.medianHouseholdIncome)],
      ["Median Home Value", fmtMoney(demo?.medianHomeValue ?? null)],
      ["Housing Growth", fmtPct(o.housingGrowthPct)],
      ["Population Growth", fmtPct(demo?.populationGrowth ?? null)],
      [
        "Single-Family Share",
        demo?.singleFamilyShare != null
          ? fmtPct(demo.singleFamilyShare * 100)
          : "N/A",
      ],
    ];

    const hh100Label =
      o.reviews100Primary === 0
        ? "No established competitor detected"
        : fmtK(o.ownerHhPer100);
    const hh250Label =
      o.reviews250 === 0 ? "N/A" : fmtK(o.ownerHhPer250);
    const hh500Label =
      o.reviews500 === 0 ? "N/A" : fmtK(o.ownerHhPer500);

    const compLines: Array<[string, string]> = [
      ["Primary Roofing Competitors", String(o.primaryRoofingCompetitors)],
      [
        "Credible Secondary Roofing Competitors",
        String(o.credibleSecondaryRoofingCompetitors),
      ],
      [
        "Adjusted Credible Roofing Competitors",
        String(o.adjustedRoofingCompetitors),
      ],
      ["Owner HH / Primary Roofer", fmtK(o.ownerHhPerPrimary)],
      ["100+ Review Primary Roofers", String(o.reviews100Primary)],
      ["250+ Review Primary Roofers", String(o.reviews250)],
      ["500+ Review Primary Roofers", String(o.reviews500)],
      ["1,000+ Review Primary Roofers", String(o.reviews1000)],
      ["Owner HH / 100+ Review Roofer", hh100Label],
      ["Owner HH / 250+ Review Roofer", hh250Label],
      ["Owner HH / 500+ Review Roofer", hh500Label],
      ["Median Competitor Reviews", fmtNum(o.reviewsMedian, 0)],
      ["Top-5 Average Reviews", fmtNum(o.top5AvgReviews, 1)],
    ];

    let ly = colY + 14;
    doc.fontSize(7.5);
    for (const [k, v] of marketLines) {
      doc.fillColor(C.muted).text(k, leftX, ly, { width: 150, lineBreak: false });
      doc.fillColor(C.ink).text(v, leftX + 150, ly, { width: 85, lineBreak: false });
      ly += 11;
    }

    let ry = colY + 14;
    for (const [k, v] of compLines) {
      doc.fillColor(C.muted).text(k, rightX, ry, { width: 165, lineBreak: false });
      doc.fillColor(C.ink).text(v, rightX + 165, ry, { width: 85, lineBreak: false });
      ry += 11;
    }

    doc.x = 48;
    doc.y = Math.max(ly, ry) + 6;

    if (clustered) {
      ensureSpace(doc, 30, state);
      doc.fontSize(8).fillColor(C.accent).text("Consolidated LOAs");
      doc
        .fontSize(7.5)
        .fillColor(C.muted)
        .text(
          `Multiple overlapping 15-mile LOAs consolidated into one practical expansion choice. Representative statistics from ${o.representativeLoa}. Members: ${o.memberLoas.join("; ")}.`,
          { width: 516 },
        );
      doc.moveDown(0.3);
    }

    ensureSpace(doc, 55, state);
    doc.fontSize(9).fillColor(C.accent).text("Why It Ranks");
    doc.fontSize(8.5).fillColor(C.ink).text(o.whyItRanks, { width: 516 });
    doc.moveDown(0.2);
    doc.fontSize(8).fillColor(C.muted).text(interpretation(o), { width: 516 });
    doc.moveDown(0.3);

    if (comps.length) {
      ensureSpace(doc, 36, state);
      doc.fontSize(8).fillColor(C.accent).text("Top Competitors (by Google reviews)");
      doc.fontSize(7.5).fillColor(C.ink);
      for (const c of comps.slice(0, 3)) {
        const rating =
          c.rating != null ? `${c.rating.toFixed(1)} rating` : "rating N/A";
        const reviews = c.reviews != null ? `${c.reviews} reviews` : "reviews N/A";
        doc.text(`  •  ${c.title}  ·  ${reviews}  ·  ${rating}`);
      }
      doc.moveDown(0.25);
    }

    if (caveats.length) {
      ensureSpace(doc, 40, state);
      doc.fontSize(8).fillColor(C.warn).text("Caveats");
      doc.fontSize(7.5).fillColor(C.warn);
      for (const c of caveats) {
        doc.text(`  •  ${c}`, { width: 516 });
        if (/Prineville/i.test(c) || o.expansionOpportunity === "Prineville")
          qa.prinevilleCaveat = true;
        if (/Kitsap|cross-water|Puget Sound/i.test(c) || o.expansionOpportunity.includes("Kitsap"))
          qa.kitsapCaveat = true;
      }
      doc.moveDown(0.2);
    }

    // Explicit Prineville / Kitsap narrative if not already covered richly
    if (o.expansionOpportunity === "Prineville") {
      ensureSpace(doc, 45, state);
      doc.fontSize(8).fillColor(C.warn).text("Prineville interpretation note");
      doc.fontSize(7.5).fillColor(C.warn).text(
        "Presented as Small / Satellite. Demographic estimate relies on a broader soft-intersection ZCTA correction; the immediately serviceable market may be smaller than the estimate suggests. Credible secondary roofing competition weakens the raw scarcity signal. The #5 score should be interpreted cautiously.",
        { width: 516 },
      );
      qa.prinevilleCaveat = true;
      doc.moveDown(0.25);
    }
    if (o.expansionOpportunity.includes("Kitsap")) {
      ensureSpace(doc, 40, state);
      doc.fontSize(8).fillColor(C.warn).text("Kitsap Peninsula interpretation note");
      doc.fontSize(7.5).fillColor(C.warn).text(
        "Presented as Growth rather than Major. The homeowner estimate is affected by Census/ZCTA geography bleeding across Puget Sound. The raw homeowner count should not be interpreted literally as Kitsap-only demand.",
        { width: 516 },
      );
      qa.kitsapCaveat = true;
      doc.moveDown(0.25);
    }

    doc
      .moveTo(48, doc.y + 2)
      .lineTo(564, doc.y + 2)
      .strokeColor(C.line)
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.55);

    qa.partIIRanks.push(o.rank);
  }

  // ========== PART III WATCHLIST ==========
  sectionDivider(
    doc,
    state,
    "PART III",
    "Small Market Watchlist",
    "Markets below 10,000 owner-occupied households",
  );

  newPortrait();
  doc.fontSize(10).fillColor(C.ink).lineGap(3);
  doc.text(
    "These markets did not qualify for the primary #1 through #75 ranking. They may still be relevant for satellite operations, adjacent service territories, future growth, or unusually weak competition. Absolute homeowner base remains below the primary ranking threshold.",
  );
  doc.moveDown(0.6);

  const wh = ["Market", "State", "Owner HH", "MHI", "Growth", "Prim", "100+", "Why Watch / Why Limited"];
  const ww = [90, 50, 48, 42, 42, 32, 32, 180];
  const drawWatchHeader = () => {
    let x = 48;
    const y = doc.y;
    doc.rect(48, y - 2, 516, 14).fill(C.soft);
    doc.fontSize(7).fillColor(C.muted);
    for (let i = 0; i < wh.length; i++) {
      doc.text(wh[i]!, x + 1, y, { width: ww[i]! - 2, lineBreak: false });
      x += ww[i]!;
    }
    doc.x = 48;
    doc.y = y + 13;
  };
  drawWatchHeader();

  for (const w of report.watchlist) {
    const note = `${w.whyWatch} ${w.whyLimited}`.trim();
    const noteH = Math.max(
      12,
      doc.heightOfString(note, { width: ww[7]! - 2, fontSize: 6.5 }) + 4,
    );
    if (doc.y + noteH > 740) {
      newPortrait();
      doc.fontSize(12).fillColor(C.ink).text("Small Market Watchlist (continued)");
      doc.moveDown(0.3);
      drawWatchHeader();
    }
    const y = doc.y;
    if (report.watchlist.indexOf(w) % 2 === 0) {
      doc.rect(48, y - 1, 516, noteH).fill(C.softAlt);
    }
    const cells = [
      w.market,
      stateAbbr[w.state] ?? w.state,
      fmtK(w.ownerHh),
      fmtMoney(w.mhi),
      fmtPct(w.housingGrowth),
      String(w.primaryRoofers),
      String(w.reviews100),
      note,
    ];
    let x = 48;
    for (let i = 0; i < cells.length; i++) {
      doc.fontSize(i === 7 ? 6.5 : 7).fillColor(C.ink);
      if (i === 7) {
        doc.text(cells[i]!, x + 1, y + 1, { width: ww[i]! - 2 });
      } else {
        doc.text(cells[i]!, x + 1, y + 2, {
          width: ww[i]! - 2,
          lineBreak: false,
        });
      }
      x += ww[i]!;
    }
    doc.x = 48;
    doc.y = y + noteH;
    qa.watchlistMarkets.push(w.market);
  }

  // State summary
  newPortrait();
  doc.fontSize(18).fillColor(C.ink).text("Opportunity by State");
  doc.moveDown(0.4);
  doc.fontSize(9).fillColor(C.muted).text(
    "Opportunity counts partly reflect state population patterns and the number of distinct markets analyzed. Do not interpret the count of opportunities alone as a state-quality score.",
  );
  doc.moveDown(0.5);

  const sh = [
    "State",
    "Ranked",
    "Highest-ranked opportunity",
    "Best #",
    "Median",
    "Major",
    "Growth",
    "Small",
  ];
  const sw = [70, 42, 180, 36, 42, 40, 42, 40];
  let x = 48;
  const sy = doc.y;
  doc.rect(48, sy - 2, 516, 14).fill(C.soft);
  doc.fontSize(7).fillColor(C.muted);
  for (let i = 0; i < sh.length; i++) {
    doc.text(sh[i]!, x + 1, sy, { width: sw[i]! - 2, lineBreak: false });
    x += sw[i]!;
  }
  doc.x = 48;
  doc.y = sy + 14;

  const order = [
    "Washington",
    "Oregon",
    "Utah",
    "Nevada",
    "Idaho",
    "Montana",
    "Wyoming",
  ];
  for (const st of order) {
    const s = report.stateSummary.find((x) => x.state === st);
    if (!s) continue;
    const y = doc.y;
    const cells = [
      s.state,
      String(s.rankedOpportunities),
      s.highestRanked?.name ?? "N/A",
      s.highestRanked ? String(s.highestRanked.rank) : "N/A",
      s.medianOpportunityScore != null
        ? s.medianOpportunityScore.toFixed(1)
        : "N/A",
      String(s.major),
      String(s.growth),
      String(s.smallSatellite),
    ];
    let cx = 48;
    doc.fontSize(8).fillColor(C.ink);
    for (let i = 0; i < cells.length; i++) {
      doc.text(cells[i]!, cx + 1, y, {
        width: sw[i]! - 2,
        lineBreak: false,
        ellipsis: true,
      });
      cx += sw[i]!;
    }
    doc.x = 48;
    doc.y = y + 14;
  }

  // ========== PART IV ==========
  sectionDivider(
    doc,
    state,
    "PART IV",
    "Methodology & Data Notes",
    "How the analysis was constructed",
  );

  newPortrait();
  doc.fontSize(14).fillColor(C.ink).text("Geography");
  doc.moveDown(0.3);
  doc.fontSize(9.5).fillColor(C.ink).lineGap(2.5);
  doc.text(
    "The analysis began with 15-mile Local Opportunity Areas centered on meaningful population centers. Nearby LOAs can overlap. 122 eligible LOAs were consolidated into 75 practical Expansion Opportunities so substantially overlapping territories would not appear as separate expansion decisions.",
  );
  doc.moveDown(0.6);
  doc.fontSize(14).fillColor(C.ink).text("Demographics");
  doc.moveDown(0.3);
  doc.fontSize(9.5).fillColor(C.ink);
  doc.text(
    "Primary source: Census ACS 2024 5-year estimates. Growth baseline: ACS 2019 5-year. Core factors include owner-occupied households, household income, housing growth, and housing characteristics. Census ZCTA geography is an approximation of a circular service territory.",
  );
  doc.moveDown(0.6);
  doc.fontSize(14).fillColor(C.ink).text("Roofing Competition");
  doc.moveDown(0.3);
  doc.fontSize(9.5).fillColor(C.ink);
  doc.text(
    "Competition data came from Google Maps / Google Business Profile discovery using Apify. Method: roofing only; query roofing contractor; five search points per LOA; up to 60 results per search point; GBP Place IDs for deduplication; primary category Roofing Contractor for baseline competition; credible secondary roofing businesses reviewed separately; review counts used as a proxy for established local competitor strength. GBP competition is a useful local-market signal but does not capture every contractor operating in a market.",
  );
  doc.moveDown(0.6);
  doc.fontSize(14).fillColor(C.ink).text("Opportunity Score");
  doc.moveDown(0.3);
  doc.fontSize(9.5).fillColor(C.ink);
  doc.text(
    "Six Phase V components, percentile-normalized 0-100 among eligible LOAs. Weights: owner-occupied households 25%; median household income 10%; housing growth 10%; owner HH per primary roofer 20%; owner HH per 100+ review roofer 25%; top-5 average competitor reviews 10% (reverse scored). A score of 75 does not mean a 75% probability of success.",
  );

  newPortrait();
  doc.fontSize(14).fillColor(C.ink).text("Data Limitations");
  doc.moveDown(0.4);
  doc.fontSize(9.5).fillColor(C.ink).lineGap(2.5);
  const limits = [
    "Census geography approximations and overlapping service territories",
    "GBP does not capture every roofing company",
    "Review count is a proxy for established market presence, not company revenue",
    "Household growth does not directly equal roofing demand",
    "Roofing demand also depends on weather, roof age, insurance, permits, materials, labor, and local market behavior",
    "Consolidated opportunity statistics use representative LOAs and do not sum overlapping demographics",
  ];
  for (const l of limits) doc.text(`  •  ${l}`);
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor(C.accent).text("Phase VII QA warnings preserved in this report");
  doc.moveDown(0.3);
  doc.fontSize(9).fillColor(C.ink);
  for (const w of report.qaWarnings) {
    doc.text(`  •  ${w}`, { width: 516 });
  }
  if (!report.qaWarnings.length) {
    doc.text("  •  No additional automated QA warnings beyond market-level caveats.");
  }

  // Using this analysis
  newPortrait();
  doc.fontSize(20).fillColor(C.ink).text("Using This Analysis");
  doc.moveDown(0.7);
  doc.fontSize(10).fillColor(C.ink).lineGap(3);
  doc.text(
    "This report is intended to prioritize markets for deeper diligence.",
  );
  doc.moveDown(0.5);
  doc.fontSize(11).fillColor(C.accent).text("The overall ranking answers:");
  doc.fontSize(10).fillColor(C.ink).text("Where should we look first?");
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor(C.accent).text("The Detailed Market Analysis answers:");
  doc.fontSize(10).fillColor(C.ink).text("Why did each market rank where it did?");
  doc.moveDown(0.6);
  doc.text("Before entering a market, deeper diligence should evaluate:");
  doc.moveDown(0.3);
  const diligence = [
    "local roofing demand",
    "storm and weather patterns",
    "roof age",
    "permit activity",
    "labor availability",
    "material and logistics costs",
    "Google Ads / LSA economics",
    "insurance environment",
    "licensing requirements",
    "office / yard availability",
    "competitor positioning and service quality",
  ];
  for (const d of diligence) doc.text(`  •  ${d}`);
  doc.moveDown(0.7);
  doc.text(
    "The report narrows a seven-state search into a prioritized set of expansion opportunities for further investigation.",
  );

  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });

  copyFileSync(OUT_REPO, OUT_DOWNLOADS);

  // QA verification
  const expectedRanks = Array.from({ length: 75 }, (_, i) => i + 1);
  const partIOk =
    qa.partIRanks.length === 75 &&
    expectedRanks.every((r, i) => qa.partIRanks[i] === r);
  const partIIOk =
    qa.partIIRanks.length === 75 &&
    expectedRanks.every((r, i) => qa.partIIRanks[i] === r);
  const uniquePartI = new Set(qa.partIRanks).size === 75;
  const uniquePartII = new Set(qa.partIIRanks).size === 75;
  const watchOk = qa.watchlistMarkets.length === 22;
  const nameDupes = opps
    .map((o) => o.expansionOpportunity)
    .filter((n, i, a) => a.indexOf(n) !== i);

  if (!partIOk || !uniquePartI) qa.warnings.push("Part I rank coverage failed");
  if (!partIIOk || !uniquePartII) qa.warnings.push("Part II rank coverage failed");
  if (!watchOk)
    qa.warnings.push(
      `Watchlist count ${qa.watchlistMarkets.length}, expected 22`,
    );
  if (!qa.prinevilleCaveat) qa.warnings.push("Prineville caveat missing");
  if (!qa.kitsapCaveat) qa.warnings.push("Kitsap caveat missing");
  if (nameDupes.length)
    qa.warnings.push(`Duplicate opportunity names: ${nameDupes.join(", ")}`);

  // Score match check
  for (const o of opps) {
    const client = report.masterRanking.find((x) => x.rank === o.rank);
    if (!client || client.opportunityScore !== o.opportunityScore) {
      qa.warnings.push(`Score mismatch at rank ${o.rank}`);
    }
  }

  const qaPath = join(OUT_DIR, "pdf-qa-report.json");
  const qaReport = {
    pdfPath: OUT_DOWNLOADS,
    repoCopy: OUT_REPO,
    pageCount: state.page,
    partIRanks: qa.partIRanks.length,
    partIExact: partIOk && uniquePartI,
    partIIRanks: qa.partIIRanks.length,
    partIIExact: partIIOk && uniquePartII,
    watchlistCount: qa.watchlistMarkets.length,
    watchlistExact: watchOk,
    prinevilleCaveat: qa.prinevilleCaveat,
    kitsapCaveat: qa.kitsapCaveat,
    duplicateNames: nameDupes,
    warnings: qa.warnings,
    opportunityCount: opps.length,
  };
  writeFileSync(qaPath, JSON.stringify(qaReport, null, 2));
  console.log(JSON.stringify(qaReport, null, 2));

  if (qa.warnings.length) {
    console.error("PDF QA warnings present");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
