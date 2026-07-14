/**
 * Dual-scope Ahrefs enrichment for Mighty Dog Boise only.
 * Pulls parent domain + location path prefix. Does not enrich other businesses.
 *
 * Usage: npm run enrich:mighty-dog-ahrefs
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  fetchAhrefsAnalysisTargets,
  fetchAhrefsUsage,
} from "../src/lib/ahrefs";
import { resolveSeoAnalysisPulls } from "../src/lib/companies";
import {
  findCompanyDomainSnapshot,
  upsertSeoSnapshot,
} from "../src/lib/seo-snapshots";

config({ path: ".env.local" });

const MIGHTY_DOG_BUSINESS_ID = "fc58b731-7755-467c-9554-66d273095f13";
const EXPECTED_WEBSITE = "https://www.mightydogroofing.com/boise-id/";

function usageUnits(payload: unknown): number | null {
  const units = (
    payload as { limits_and_usage?: { units_usage_workspace?: number } } | null
  )?.limits_and_usage?.units_usage_workspace;
  return typeof units === "number" && Number.isFinite(units) ? units : null;
}

async function main() {
  const db = await connectAdminPg();
  let business: {
    id: string;
    name: string;
    website_url: string | null;
    company_id: string | null;
  };
  try {
    const { rows } = await db.query<{
      id: string;
      name: string;
      website_url: string | null;
      company_id: string | null;
    }>(
      `select id, name, website_url, company_id
       from public.businesses where id = $1`,
      [MIGHTY_DOG_BUSINESS_ID],
    );
    if (!rows[0]) throw new Error("Mighty Dog business not found");
    business = rows[0];
  } finally {
    await db.end();
  }

  const resolved = resolveSeoAnalysisPulls(
    business.website_url ?? EXPECTED_WEBSITE,
  );
  if (resolved.pulls.length < 2) {
    throw new Error(
      `Expected dual-scope pulls for Mighty Dog, got ${JSON.stringify(resolved)}`,
    );
  }

  // Keep businesses.analysis_* pointing at the location when dual-scope.
  const locationPull = resolved.pulls.find((p) => p.scope === "business_location");
  const parentPull = resolved.pulls.find((p) => p.scope === "company_domain");
  if (!locationPull || !parentPull) {
    throw new Error("Missing parent or location pull");
  }

  {
    const client = await connectAdminPg();
    try {
      await client.query(
        `update public.businesses
         set analysis_target = $2,
             analysis_mode = $3,
             updated_at = now()
         where id = $1`,
        [business.id, locationPull.analysisTarget, locationPull.analysisMode],
      );
      if (business.company_id) {
        await client.query(
          `update public.companies
           set company_type = case
                 when company_type = 'independent' then 'franchise'
                 else company_type
               end,
               root_domain = coalesce(root_domain, $2),
               website = coalesce(website, $3),
               updated_at = now()
           where id = $1`,
          [
            business.company_id,
            parentPull.parentDomain,
            `https://www.${parentPull.parentDomain}/`,
          ],
        );
      }
    } finally {
      await client.end();
    }
  }

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const usageBefore = await fetchAhrefsUsage();
  const unitsBefore = usageUnits(usageBefore);

  const inserted: unknown[] = [];
  const reusedParent = await findCompanyDomainSnapshot({
    parentDomain: parentPull.parentDomain,
    snapshotDate,
  });

  // Fetch only what we don't already have for today.
  const pullsToFetch = resolved.pulls.filter((pull) => {
    if (
      pull.scope === "company_domain" &&
      reusedParent &&
      reusedParent.analysisTarget === pull.analysisTarget
    ) {
      return false;
    }
    return true;
  });

  const batch =
    pullsToFetch.length > 0
      ? await fetchAhrefsAnalysisTargets(pullsToFetch)
      : null;

  const usageAfter = await fetchAhrefsUsage();
  const unitsAfter = usageUnits(usageAfter);
  const totalUnitsConsumed =
    unitsBefore !== null && unitsAfter !== null && unitsAfter > unitsBefore
      ? unitsAfter - unitsBefore
      : (batch?.unitsCost ?? 0);

  for (const pull of resolved.pulls) {
    if (pull.scope === "company_domain" && reusedParent) {
      const linked = await upsertSeoSnapshot({
        businessId: business.id,
        domain: pull.parentDomain,
        snapshotDate,
        scope: pull.scope,
        analysisTarget: pull.analysisTarget,
        analysisMode: pull.analysisMode,
        parentDomain: pull.parentDomain,
        locationPath: pull.locationPath,
        metrics: {
          domain: reusedParent.domain,
          domainRating: reusedParent.domainRating,
          referringDomains: reusedParent.referringDomains,
          backlinks: reusedParent.backlinks,
          organicTraffic: reusedParent.organicTraffic,
          organicKeywords: reusedParent.organicKeywords,
          organicKeywordsTop3: reusedParent.organicKeywordsTop3,
          trafficValue: reusedParent.trafficValue,
        },
        rawResponse: {
          reusedFromSnapshotId: reusedParent.id,
          reusedBusinessId: reusedParent.businessId,
          note: "Parent-domain metrics reused for same snapshot_date",
        },
      });
      inserted.push({ ...linked, reused: true });
      continue;
    }

    const metrics = batch?.byTarget.get(pull.analysisTarget);
    if (!metrics) {
      throw new Error(`No Ahrefs metrics for ${pull.analysisTarget}`);
    }

    const row = await upsertSeoSnapshot({
      businessId: business.id,
      domain:
        pull.scope === "company_domain"
          ? pull.parentDomain
          : metrics.domain || pull.parentDomain,
      snapshotDate,
      scope: pull.scope,
      analysisTarget: pull.analysisTarget,
      analysisMode: pull.analysisMode,
      parentDomain: pull.parentDomain,
      locationPath: pull.locationPath,
      metrics,
      rawResponse: {
        endpoint: batch?.endpoint,
        analysisTarget: pull.analysisTarget,
        analysisMode: pull.analysisMode,
        scope: pull.scope,
        unitsCostBatch: batch?.unitsCost,
        fetchedAt: new Date().toISOString(),
        usageBefore,
        usageAfter,
        ahrefs: batch?.rawResponse,
      },
    });
    inserted.push({ ...row, reused: false });
  }

  const parent = inserted.find(
    (r) => (r as { scope: string }).scope === "company_domain",
  ) as {
    domainRating: number | null;
    organicTraffic: number | null;
    organicKeywords: number | null;
    referringDomains: number | null;
    backlinks: number | null;
    trafficValue: number | null;
    analysisTarget: string;
    id: string;
  };
  const location = inserted.find(
    (r) => (r as { scope: string }).scope === "business_location",
  ) as {
    domainRating: number | null;
    organicTraffic: number | null;
    organicKeywords: number | null;
    organicKeywordsTop3: number | null;
    referringDomains: number | null;
    backlinks: number | null;
    trafficValue: number | null;
    analysisTarget: string;
    analysisMode: string;
    locationPath: string | null;
    id: string;
  };

  console.log(
    JSON.stringify(
      {
        ok: true,
        business: business.name,
        website: business.website_url,
        resolvedPulls: resolved.pulls,
        unitsHeader: batch?.unitsCost ?? null,
        totalUnitsConsumed,
        snapshotsInserted: inserted.length,
        parentMetrics: parent
          ? {
              snapshotId: parent.id,
              analysisTarget: parent.analysisTarget,
              domainRating: parent.domainRating,
              organicTraffic: parent.organicTraffic,
              organicKeywords: parent.organicKeywords,
              referringDomains: parent.referringDomains,
              backlinks: parent.backlinks,
              trafficValue: parent.trafficValue,
            }
          : null,
        locationMetrics: location
          ? {
              snapshotId: location.id,
              analysisTarget: location.analysisTarget,
              analysisMode: location.analysisMode,
              locationPath: location.locationPath,
              domainRating: location.domainRating,
              organicTraffic: location.organicTraffic,
              organicKeywords: location.organicKeywords,
              organicKeywordsTop3: location.organicKeywordsTop3,
              referringDomains: location.referringDomains,
              backlinks: location.backlinks,
              trafficValue: location.trafficValue,
            }
          : null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
