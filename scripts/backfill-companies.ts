/**
 * Backfill companies from existing businesses.
 * Groups by root domain; does not merge Google Place IDs.
 *
 * Usage: npm run backfill:companies
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  determineAnalysis,
  determineCompanyType,
  parseWebsite,
} from "../src/lib/companies";

config({ path: ".env.local" });

type Biz = {
  id: string;
  name: string;
  website_url: string | null;
};

async function main() {
  const db = await connectAdminPg();
  try {
    const { rows: businesses } = await db.query<Biz>(
      `select id, name, website_url from public.businesses order by name asc`,
    );

    type Group = {
      key: string;
      rootDomain: string | null;
      members: { biz: Biz; parsed: ReturnType<typeof parseWebsite> }[];
    };

    const groups = new Map<string, Group>();

    for (const biz of businesses) {
      const parsed = parseWebsite(biz.website_url);
      const key = parsed?.rootDomain
        ? `domain:${parsed.rootDomain}`
        : `solo:${biz.id}`;
      const existing = groups.get(key);
      if (existing) {
        existing.members.push({ biz, parsed });
      } else {
        groups.set(key, {
          key,
          rootDomain: parsed?.rootDomain ?? null,
          members: [{ biz, parsed }],
        });
      }
    }

    let companiesCreated = 0;
    let businessesLinked = 0;
    let domainMode = 0;
    let prefixMode = 0;
    let subdomainMode = 0;
    let exactUrlMode = 0;
    let manualReview = 0;
    const manualReviewDetails: unknown[] = [];

    await db.query("begin");

    // Reset prior backfill links so reruns are idempotent.
    await db.query(
      `update public.businesses
       set company_id = null, analysis_target = null, analysis_mode = null`,
    );
    await db.query(`delete from public.companies`);

    for (const group of groups.values()) {
      const shareCount = group.members.length;
      const hasWebsite = group.members.some((m) => m.parsed !== null);
      const anyPrefixOrSubdomain = group.members.some((m) => {
        if (!m.parsed) return false;
        const a = determineAnalysis({
          parsed: m.parsed,
          shareCount,
        });
        return a.analysisMode === "prefix" || a.analysisMode === "subdomain";
      });

      const companyType = determineCompanyType({
        shareCount,
        hasWebsite,
        anyPrefixOrSubdomain,
      });

      const companyName =
        shareCount === 1
          ? group.members[0]!.biz.name
          : group.rootDomain
            ? group.rootDomain
            : group.members[0]!.biz.name;

      const website =
        group.members.find((m) => m.parsed && !m.parsed.hasLocationPath && !m.parsed.isSubdomain)
          ?.biz.website_url ??
        group.members.find((m) => m.biz.website_url)?.biz.website_url ??
        null;

      const { rows: companyRows } = await db.query<{ id: string }>(
        `insert into public.companies (
          company_name, root_domain, company_type, website
        ) values ($1, $2, $3, $4)
        returning id`,
        [companyName, group.rootDomain, companyType, website],
      );
      const companyId = companyRows[0]!.id;
      companiesCreated += 1;

      for (const member of group.members) {
        const analysis = determineAnalysis({
          parsed: member.parsed,
          shareCount,
        });

        if (analysis.needsManualReview) {
          manualReview += 1;
          manualReviewDetails.push({
            businessId: member.biz.id,
            name: member.biz.name,
            website: member.biz.website_url,
            reason: analysis.reason,
          });
        }

        if (analysis.analysisMode === "domain") domainMode += 1;
        else if (analysis.analysisMode === "prefix") prefixMode += 1;
        else if (analysis.analysisMode === "subdomain") subdomainMode += 1;
        else if (analysis.analysisMode === "exact_url") exactUrlMode += 1;

        await db.query(
          `update public.businesses
           set company_id = $2,
               analysis_target = $3,
               analysis_mode = $4,
               updated_at = now()
           where id = $1`,
          [
            member.biz.id,
            companyId,
            analysis.analysisTarget,
            analysis.analysisMode,
          ],
        );
        businessesLinked += 1;
      }
    }

    await db.query("commit");

    console.log(
      JSON.stringify(
        {
          ok: true,
          companiesCreated,
          businessesLinked,
          domainMode,
          prefixMode,
          subdomainMode,
          exactUrlMode,
          manualReview,
          manualReviewDetails,
          companyTypeBreakdown: (
            await db.query<{ company_type: string; n: number }>(
              `select company_type, count(*)::int as n
               from public.companies
               group by company_type
               order by n desc`,
            )
          ).rows,
          samplePrefixOrShared: (
            await db.query(
              `select b.name, b.website_url, b.analysis_mode, b.analysis_target,
                      c.company_name, c.company_type, c.root_domain
               from public.businesses b
               join public.companies c on c.id = b.company_id
               where b.analysis_mode is distinct from 'domain'
                  or c.company_type <> 'independent'
               order by b.name
               limit 20`,
            )
          ).rows,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await db.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
