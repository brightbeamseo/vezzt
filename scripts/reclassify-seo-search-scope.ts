/**
 * Reclassify search_scope on all seo_snapshots using company + analysis shape.
 * Does NOT call Ahrefs.
 *
 * Usage: npm run reclassify:seo-search-scope
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import type { AnalysisMode, CompanyScale, SeoScope } from "../src/lib/companies";
import { determineSearchScope } from "../src/lib/search-scope";

config({ path: ".env.local" });

type SnapRow = {
  id: string;
  business_id: string;
  business_name: string;
  scope: SeoScope;
  analysis_target: string;
  analysis_mode: AnalysisMode;
  location_path: string | null;
  company_scale: CompanyScale | null;
  ownership_model: string | null;
  location_count: number | null;
};

async function main() {
  const db = await connectAdminPg();
  try {
    const { rows } = await db.query<SnapRow>(
      `select
         s.id,
         s.business_id,
         b.name as business_name,
         s.scope,
         s.analysis_target,
         s.analysis_mode,
         s.location_path,
         c.company_scale,
         c.ownership_model,
         c.location_count
       from public.seo_snapshots s
       join public.businesses b on b.id = s.business_id
       left join public.companies c on c.id = b.company_id
       order by b.name, s.scope, s.snapshot_date desc`,
    );

    const counts = {
      location: 0,
      company: 0,
      mixed: 0,
      unknown: 0,
    };
    const manualReviewBiz = new Map<
      string,
      { name: string; reasons: Set<string> }
    >();
    let mightyDog: unknown[] = [];

    for (const row of rows) {
      const result = determineSearchScope({
        scope: row.scope,
        analysisMode: row.analysis_mode,
        analysisTarget: row.analysis_target,
        locationPath: row.location_path,
        companyScale: row.company_scale,
        locationCount: row.location_count,
      });

      await db.query(
        `update public.seo_snapshots
         set search_scope = $2
         where id = $1`,
        [row.id, result.searchScope],
      );

      counts[result.searchScope] += 1;

      if (result.needsManualReview || result.searchScope === "unknown") {
        const existing = manualReviewBiz.get(row.business_id) ?? {
          name: row.business_name,
          reasons: new Set<string>(),
        };
        existing.reasons.add(result.reason);
        manualReviewBiz.set(row.business_id, existing);
      }

      if (
        row.business_name.toLowerCase().includes("mighty dog") ||
        row.analysis_target.toLowerCase().includes("mightydog")
      ) {
        mightyDog.push({
          analysisTarget: row.analysis_target,
          analysisMode: row.analysis_mode,
          scope: row.scope,
          searchScope: result.searchScope,
          reason: result.reason,
        });
      }
    }

    const manualReview = [...manualReviewBiz.entries()].map(
      ([id, v]) => ({
        businessId: id,
        name: v.name,
        reasons: [...v.reasons],
      }),
    );

    console.log(
      JSON.stringify(
        {
          snapshotsProcessed: rows.length,
          counts,
          manualReviewCount: manualReview.length,
          manualReview,
          mightyDog,
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
