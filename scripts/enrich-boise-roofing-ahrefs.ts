/**
 * Bulk Ahrefs SEO enrichment for qualified Boise Metro roofers (100+ reviews).
 *
 * Usage:
 *   npm run enrich:boise-roofing-ahrefs
 *
 * Append-only seo_snapshots inserts. Does not call Apify or LBM.
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  fetchAhrefsDomainSummaries,
  fetchAhrefsUsage,
  normalizeAhrefsDomain,
} from "../src/lib/ahrefs";
import { getMarket, normalizeCityName } from "../src/lib/markets";
import { insertSeoSnapshot } from "../src/lib/seo-snapshots";

config({ path: ".env.local" });

type Candidate = {
  id: string;
  name: string;
  city: string | null;
  website_url: string | null;
  review_count: number | null;
};

type SuccessRow = {
  businessId: string;
  name: string;
  city: string | null;
  websiteUrl: string;
  domain: string;
  snapshotId: string;
  domainRating: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  organicKeywordsTop3: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  trafficValue: number | null;
};

function usageUnits(payload: unknown): number | null {
  const units = (
    payload as { limits_and_usage?: { units_usage_workspace?: number } } | null
  )?.limits_and_usage?.units_usage_workspace;
  return typeof units === "number" && Number.isFinite(units) ? units : null;
}

async function main() {
  const market = getMarket("boise-metro");
  const allowedCities = new Set(market.cities.map(normalizeCityName));
  const db = await connectAdminPg();

  let candidates: Candidate[];
  try {
    const { rows } = await db.query<Candidate>(`
      select
        b.id,
        b.name,
        b.city,
        b.website_url,
        latest.review_count
      from public.businesses b
      left join lateral (
        select rs.review_count
        from public.review_snapshots rs
        where rs.business_id = b.id
        order by rs.snapshot_date desc, rs.created_at desc
        limit 1
      ) latest on true
      where b.qualification_status = 'qualified'
        and b.primary_category = 'Roofing contractor'
        and coalesce(latest.review_count, 0) >= 100
      order by latest.review_count desc nulls last, b.name asc
    `);
    candidates = rows.filter(
      (row) => row.city && allowedCities.has(normalizeCityName(row.city)),
    );
  } finally {
    await db.end();
  }

  const skippedMissingWebsite = candidates.filter(
    (c) => !c.website_url || !c.website_url.trim(),
  );
  const withWebsite = candidates.filter(
    (c) => c.website_url && c.website_url.trim(),
  );

  console.log(
    JSON.stringify(
      {
        selected: candidates.length,
        withWebsite: withWebsite.length,
        skippedMissingWebsite: skippedMissingWebsite.map((c) => ({
          id: c.id,
          name: c.name,
          city: c.city,
          reviewCount: c.review_count,
        })),
        businesses: withWebsite.map((c) => ({
          id: c.id,
          name: c.name,
          city: c.city,
          website: c.website_url,
          reviewCount: c.review_count,
          domain: normalizeAhrefsDomain(c.website_url!),
        })),
      },
      null,
      2,
    ),
  );

  if (withWebsite.length === 0) {
    console.log(
      JSON.stringify({
        ok: true,
        message: "No businesses with websites to enrich.",
        totalUnitsConsumed: 0,
        successful: 0,
        failed: 0,
        skippedMissingWebsite: skippedMissingWebsite.length,
        snapshotsInserted: 0,
      }),
    );
    return;
  }

  const domainByBusiness = withWebsite.map((c) => ({
    ...c,
    domain: normalizeAhrefsDomain(c.website_url!),
  }));

  const usageBeforeRaw = await fetchAhrefsUsage();
  const unitsBefore = usageUnits(usageBeforeRaw);

  const batch = await fetchAhrefsDomainSummaries(
    domainByBusiness.map((c) => c.domain),
  );

  const usageAfterRaw = await fetchAhrefsUsage();
  const unitsAfter = usageUnits(usageAfterRaw);
  const totalUnitsConsumed =
    unitsBefore !== null && unitsAfter !== null && unitsAfter > unitsBefore
      ? unitsAfter - unitsBefore
      : (batch.unitsCost ?? 0);

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const successes: SuccessRow[] = [];
  const failures: { businessId: string; name: string; domain: string; error: string }[] =
    [];

  for (const business of domainByBusiness) {
    const metrics = batch.byDomain.get(business.domain);
    if (!metrics) {
      failures.push({
        businessId: business.id,
        name: business.name,
        domain: business.domain,
        error: "No Ahrefs row returned for domain",
      });
      continue;
    }

    try {
      const snapshot = await insertSeoSnapshot({
        businessId: business.id,
        domain: business.domain,
        snapshotDate,
        metrics: { ...metrics, domain: business.domain },
        rawResponse: {
          endpoint: batch.endpoint,
          unitsCostBatch: batch.unitsCost,
          fetchedAt: new Date().toISOString(),
          usageBefore: usageBeforeRaw,
          usageAfter: usageAfterRaw,
          ahrefsTarget: batch.byDomain.get(business.domain)
            ? {
                domain: business.domain,
                metrics,
              }
            : null,
          ahrefsBatch: batch.rawResponse,
        },
      });

      successes.push({
        businessId: business.id,
        name: business.name,
        city: business.city,
        websiteUrl: business.website_url!,
        domain: business.domain,
        snapshotId: snapshot.id,
        domainRating: snapshot.domainRating,
        organicTraffic: snapshot.organicTraffic,
        organicKeywords: snapshot.organicKeywords,
        organicKeywordsTop3: snapshot.organicKeywordsTop3,
        referringDomains: snapshot.referringDomains,
        backlinks: snapshot.backlinks,
        trafficValue: snapshot.trafficValue,
      });
    } catch (error) {
      failures.push({
        businessId: business.id,
        name: business.name,
        domain: business.domain,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: failures.length === 0,
        endpoint: batch.endpoint,
        unitsHeader: batch.unitsCost,
        totalUnitsConsumed,
        unitsBefore,
        unitsAfter,
        successful: successes.length,
        failed: failures.length,
        skippedMissingWebsite: skippedMissingWebsite.length,
        snapshotsInserted: successes.length,
        failures,
        skipped: skippedMissingWebsite.map((c) => ({
          id: c.id,
          name: c.name,
          reason: "missing_website",
        })),
        results: successes.map((s) => ({
          name: s.name,
          city: s.city,
          domain: s.domain,
          domainRating: s.domainRating,
          organicTraffic: s.organicTraffic,
          organicKeywords: s.organicKeywords,
          organicKeywordsTop3: s.organicKeywordsTop3,
          referringDomains: s.referringDomains,
          backlinks: s.backlinks,
          trafficValue: s.trafficValue,
          snapshotId: s.snapshotId,
        })),
      },
      null,
      2,
    ),
  );

  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
