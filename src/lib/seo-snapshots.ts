import type { Client } from "pg";
import { connectAdminPg } from "@/lib/admin-db";
import type { AhrefsSummaryMetrics } from "@/lib/ahrefs";
import type {
  AnalysisMode,
  CompanyScale,
  SeoScope,
} from "@/lib/companies";
import {
  determineSearchScope,
  type SearchScope,
} from "@/lib/search-scope";

export type SeoSnapshotRow = {
  id: string;
  businessId: string;
  provider: string;
  domain: string;
  scope: SeoScope;
  analysisTarget: string;
  analysisMode: AnalysisMode;
  parentDomain: string | null;
  locationPath: string | null;
  searchScope: SearchScope;
  snapshotDate: string;
  domainRating: number | null;
  referringDomains: number | null;
  backlinks: number | null;
  organicTraffic: number | null;
  organicKeywords: number | null;
  organicKeywordsTop3: number | null;
  trafficValue: number | null;
  createdAt: string;
};

type DbSeoRow = {
  id: string;
  business_id: string;
  provider: string;
  domain: string;
  scope: SeoScope;
  analysis_target: string;
  analysis_mode: AnalysisMode;
  parent_domain: string | null;
  location_path: string | null;
  search_scope: SearchScope;
  snapshot_date: string;
  domain_rating: string | number | null;
  referring_domains: number | null;
  backlinks: number | null;
  organic_traffic: number | null;
  organic_keywords: number | null;
  organic_keywords_top3: number | null;
  traffic_value: string | number | null;
  created_at: string;
};

function mapRow(row: DbSeoRow): SeoSnapshotRow {
  return {
    id: row.id,
    businessId: row.business_id,
    provider: row.provider,
    domain: row.domain,
    scope: row.scope,
    analysisTarget: row.analysis_target,
    analysisMode: row.analysis_mode,
    parentDomain: row.parent_domain,
    locationPath: row.location_path,
    searchScope: row.search_scope ?? "unknown",
    snapshotDate: row.snapshot_date,
    domainRating:
      row.domain_rating === null || row.domain_rating === undefined
        ? null
        : Number(row.domain_rating),
    referringDomains: row.referring_domains,
    backlinks: row.backlinks,
    organicTraffic: row.organic_traffic,
    organicKeywords: row.organic_keywords,
    organicKeywordsTop3: row.organic_keywords_top3,
    trafficValue:
      row.traffic_value === null || row.traffic_value === undefined
        ? null
        : Number(row.traffic_value),
    createdAt: row.created_at,
  };
}

/**
 * Insert or refresh a scoped SEO snapshot for the uniqueness key.
 * Append-only across dates; same-day/same-scope re-runs upsert.
 */
export async function upsertSeoSnapshot(input: {
  businessId: string;
  domain: string;
  snapshotDate: string;
  scope: SeoScope;
  analysisTarget: string;
  analysisMode: AnalysisMode;
  parentDomain: string | null;
  locationPath: string | null;
  metrics: AhrefsSummaryMetrics;
  rawResponse: unknown;
  provider?: string;
  client?: Client;
  /** Explicit search_scope; otherwise derived from company + analysis shape. */
  searchScope?: SearchScope;
  companyScale?: CompanyScale | null;
  locationCount?: number | null;
}): Promise<SeoSnapshotRow> {
  const owns = !input.client;
  const db = input.client ?? (await connectAdminPg());

  const searchScope =
    input.searchScope ??
    determineSearchScope({
      scope: input.scope,
      analysisMode: input.analysisMode,
      analysisTarget: input.analysisTarget,
      locationPath: input.locationPath,
      companyScale: input.companyScale,
      locationCount: input.locationCount,
    }).searchScope;

  try {
    const { rows } = await db.query<DbSeoRow>(
      `insert into public.seo_snapshots (
        business_id, provider, domain, snapshot_date,
        scope, analysis_target, analysis_mode, parent_domain, location_path,
        search_scope,
        domain_rating, referring_domains, backlinks,
        organic_traffic, organic_keywords, organic_keywords_top3,
        traffic_value, raw_response
      ) values (
        $1, $2, $3, $4::date,
        $5, $6, $7, $8, $9,
        $10,
        $11, $12, $13,
        $14, $15, $16,
        $17, $18::jsonb
      )
      on conflict (business_id, provider, snapshot_date, scope, analysis_target, analysis_mode)
      do update set
        domain = excluded.domain,
        parent_domain = excluded.parent_domain,
        location_path = excluded.location_path,
        search_scope = excluded.search_scope,
        domain_rating = excluded.domain_rating,
        referring_domains = excluded.referring_domains,
        backlinks = excluded.backlinks,
        organic_traffic = excluded.organic_traffic,
        organic_keywords = excluded.organic_keywords,
        organic_keywords_top3 = excluded.organic_keywords_top3,
        traffic_value = excluded.traffic_value,
        raw_response = excluded.raw_response
      returning
        id, business_id, provider, domain, snapshot_date::text,
        scope, analysis_target, analysis_mode, parent_domain, location_path,
        search_scope,
        domain_rating, referring_domains, backlinks,
        organic_traffic, organic_keywords, organic_keywords_top3,
        traffic_value, created_at`,
      [
        input.businessId,
        input.provider ?? "ahrefs",
        input.domain,
        input.snapshotDate,
        input.scope,
        input.analysisTarget,
        input.analysisMode,
        input.parentDomain,
        input.locationPath,
        searchScope,
        input.metrics.domainRating,
        input.metrics.referringDomains,
        input.metrics.backlinks,
        input.metrics.organicTraffic,
        input.metrics.organicKeywords,
        input.metrics.organicKeywordsTop3,
        input.metrics.trafficValue,
        JSON.stringify(input.rawResponse ?? null),
      ],
    );

    const row = rows[0];
    if (!row) throw new Error("seo_snapshots upsert returned no row.");
    return mapRow(row);
  } finally {
    if (owns) await db.end();
  }
}

/** @deprecated Use upsertSeoSnapshot with explicit scope fields. */
export async function insertSeoSnapshot(input: {
  businessId: string;
  domain: string;
  snapshotDate: string;
  metrics: AhrefsSummaryMetrics;
  rawResponse: unknown;
  provider?: string;
  client?: Client;
  scope?: SeoScope;
  analysisTarget?: string;
  analysisMode?: AnalysisMode;
  parentDomain?: string | null;
  locationPath?: string | null;
}): Promise<SeoSnapshotRow> {
  return upsertSeoSnapshot({
    businessId: input.businessId,
    domain: input.domain,
    snapshotDate: input.snapshotDate,
    scope: input.scope ?? "company_domain",
    analysisTarget: input.analysisTarget ?? input.domain,
    analysisMode: input.analysisMode ?? "domain",
    parentDomain: input.parentDomain ?? input.domain,
    locationPath: input.locationPath ?? null,
    metrics: input.metrics,
    rawResponse: input.rawResponse,
    provider: input.provider,
    client: input.client,
  });
}

/**
 * Find an existing same-day parent-domain snapshot to reuse across company locations.
 */
export async function findCompanyDomainSnapshot(input: {
  parentDomain: string;
  snapshotDate: string;
  provider?: string;
  client?: Client;
}): Promise<SeoSnapshotRow | null> {
  const owns = !input.client;
  const db = input.client ?? (await connectAdminPg());
  try {
    const { rows } = await db.query<DbSeoRow>(
      `select
        id, business_id, provider, domain, snapshot_date::text,
        scope, analysis_target, analysis_mode, parent_domain, location_path,
        search_scope,
        domain_rating, referring_domains, backlinks,
        organic_traffic, organic_keywords, organic_keywords_top3,
        traffic_value, created_at
       from public.seo_snapshots
       where provider = $1
         and snapshot_date = $2::date
         and scope = 'company_domain'
         and analysis_mode = 'domain'
         and parent_domain = $3
       order by created_at desc
       limit 1`,
      [input.provider ?? "ahrefs", input.snapshotDate, input.parentDomain],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  } finally {
    if (owns) await db.end();
  }
}
