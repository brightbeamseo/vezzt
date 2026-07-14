/**
 * Reclassify all companies with company_scale + ownership_model.
 * Skips rows where classification_is_manual = true.
 *
 * Usage: npm run reclassify:companies
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import { classifyCompany } from "../src/lib/companies";
import { MARKETS } from "../src/lib/markets";

config({ path: ".env.local" });

async function main() {
  const db = await connectAdminPg();
  try {
    const { rows: companies } = await db.query<{
      id: string;
      company_name: string;
      root_domain: string | null;
      classification_is_manual: boolean;
    }>(
      `select id, company_name, root_domain, classification_is_manual
       from public.companies
       order by company_name`,
    );

    let updated = 0;
    let skippedManual = 0;
    const multiLocationCompanies: unknown[] = [];
    const manualReview: unknown[] = [];
    let mightyDog: unknown = null;

    for (const company of companies) {
      const { rows: locations } = await db.query<{
        id: string;
        city: string | null;
        state: string | null;
        website_url: string | null;
        market_id: string | null;
      }>(
        `select id, city, state, website_url, market_id
         from public.businesses
         where company_id = $1`,
        [company.id],
      );

      const classification = classifyCompany({
        rootDomain: company.root_domain,
        metroCityAllowlist: MARKETS["boise-metro"].cities,
        locations: locations.map((l) => ({
          id: l.id,
          city: l.city,
          state: l.state,
          websiteUrl: l.website_url,
          marketId: l.market_id,
        })),
      });

      if (company.classification_is_manual) {
        skippedManual += 1;
        continue;
      }

      await db.query(
        `update public.companies set
          company_scale = $2,
          ownership_model = $3,
          location_count = $4,
          service_states = $5,
          service_markets = $6,
          classification_confidence = $7,
          classification_reason = $8,
          classification_updated_at = now(),
          company_type = case
            when $3 = 'franchise' then 'franchise'
            when $2 = 'multi_location' then 'multi_location'
            when $2 = 'regional' then 'regional'
            when $3 = 'independent' then 'independent'
            else company_type
          end,
          updated_at = now()
         where id = $1`,
        [
          company.id,
          classification.companyScale,
          classification.ownershipModel,
          classification.locationCount,
          classification.serviceStates,
          classification.serviceMarkets,
          classification.classificationConfidence,
          classification.classificationReason,
        ],
      );
      updated += 1;

      const summary = {
        id: company.id,
        name: company.company_name,
        rootDomain: company.root_domain,
        ...classification,
      };

      if (classification.locationCount >= 2) {
        multiLocationCompanies.push(summary);
      }
      if (classification.needsManualReview) {
        manualReview.push(summary);
      }
      if (/mighty dog/i.test(company.company_name)) {
        mightyDog = summary;
      }
    }

    const scaleCounts = (
      await db.query<{ company_scale: string; n: number }>(
        `select company_scale, count(*)::int as n
         from public.companies
         group by company_scale
         order by n desc`,
      )
    ).rows;

    const ownershipCounts = (
      await db.query<{ ownership_model: string; n: number }>(
        `select ownership_model, count(*)::int as n
         from public.companies
         group by ownership_model
         order by n desc`,
      )
    ).rows;

    console.log(
      JSON.stringify(
        {
          ok: true,
          updated,
          skippedManual,
          companyScaleCounts: scaleCounts,
          ownershipModelCounts: ownershipCounts,
          companiesWithMultipleLinkedLocations: multiLocationCompanies.length,
          multiLocationCompanies,
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
