import type { Client } from "pg";
import { connectAdminPg } from "@/lib/admin-db";
import type { AhrefsSummaryMetrics } from "@/lib/ahrefs";

export type SeoSnapshotRow = {
  id: string;
  businessId: string;
  provider: string;
  domain: string;
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

/**
 * Insert a new historical SEO snapshot. Never upserts / overwrites.
 */
export async function insertSeoSnapshot(input: {
  businessId: string;
  domain: string;
  snapshotDate: string;
  metrics: AhrefsSummaryMetrics;
  rawResponse: unknown;
  provider?: string;
  client?: Client;
}): Promise<SeoSnapshotRow> {
  const owns = !input.client;
  const db = input.client ?? (await connectAdminPg());

  try {
    const { rows } = await db.query<{
      id: string;
      business_id: string;
      provider: string;
      domain: string;
      snapshot_date: string;
      domain_rating: string | number | null;
      referring_domains: number | null;
      backlinks: number | null;
      organic_traffic: number | null;
      organic_keywords: number | null;
      organic_keywords_top3: number | null;
      traffic_value: string | number | null;
      created_at: string;
    }>(
      `insert into public.seo_snapshots (
        business_id, provider, domain, snapshot_date,
        domain_rating, referring_domains, backlinks,
        organic_traffic, organic_keywords, organic_keywords_top3,
        traffic_value, raw_response
      ) values (
        $1, $2, $3, $4::date,
        $5, $6, $7,
        $8, $9, $10,
        $11, $12::jsonb
      )
      returning
        id, business_id, provider, domain, snapshot_date::text,
        domain_rating, referring_domains, backlinks,
        organic_traffic, organic_keywords, organic_keywords_top3,
        traffic_value, created_at`,
      [
        input.businessId,
        input.provider ?? "ahrefs",
        input.domain,
        input.snapshotDate,
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
    if (!row) throw new Error("seo_snapshots insert returned no row.");

    return {
      id: row.id,
      businessId: row.business_id,
      provider: row.provider,
      domain: row.domain,
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
  } finally {
    if (owns) await db.end();
  }
}
