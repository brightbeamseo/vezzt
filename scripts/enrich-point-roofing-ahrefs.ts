/**
 * One-business Ahrefs enrichment for Point Roofing & Restoration.
 *
 * Usage:
 *   npm run enrich:point-roofing-ahrefs
 *
 * Creates an append-only seo_snapshots row. Does not overwrite prior rows.
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  fetchAhrefsDomainSummary,
  fetchAhrefsUsage,
  normalizeAhrefsDomain,
} from "../src/lib/ahrefs";
import { insertSeoSnapshot } from "../src/lib/seo-snapshots";

config({ path: ".env.local" });

const POINT_ROOFING_BUSINESS_ID = "fd5fac35-36a2-47dc-96bf-0bcec6b3ed0f";
const POINT_ROOFING_WEBSITE = "https://www.pointroof.com/";

async function main() {
  const domain = normalizeAhrefsDomain(POINT_ROOFING_WEBSITE);
  if (domain !== "pointroof.com") {
    throw new Error(`Expected domain pointroof.com, got ${domain}`);
  }

  const db = await connectAdminPg();
  try {
    const { rows } = await db.query<{ id: string; name: string }>(
      `select id, name from public.businesses where id = $1`,
      [POINT_ROOFING_BUSINESS_ID],
    );
    if (!rows[0]) {
      throw new Error(
        `Business not found: ${POINT_ROOFING_BUSINESS_ID}`,
      );
    }
    console.log(`Business: ${rows[0].name} (${rows[0].id})`);
  } finally {
    await db.end();
  }

  const usageBefore = await fetchAhrefsUsage();
  console.log("Usage before:", JSON.stringify(usageBefore));

  const result = await fetchAhrefsDomainSummary(domain);
  console.log("Endpoint:", result.endpoint);
  console.log("Units (header):", result.unitsCost);
  console.log("Metrics:", JSON.stringify(result.metrics, null, 2));

  const usageAfter = await fetchAhrefsUsage();
  console.log("Usage after:", JSON.stringify(usageAfter));

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const snapshot = await insertSeoSnapshot({
    businessId: POINT_ROOFING_BUSINESS_ID,
    domain: result.metrics.domain,
    snapshotDate,
    metrics: result.metrics,
    rawResponse: {
      endpoint: result.endpoint,
      unitsCost: result.unitsCost,
      fetchedAt: new Date().toISOString(),
      usageBefore,
      usageAfter,
      ahrefs: result.rawResponse,
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        endpoint: result.endpoint,
        unitsCost: result.unitsCost,
        metrics: result.metrics,
        snapshot: {
          id: snapshot.id,
          businessId: snapshot.businessId,
          domain: snapshot.domain,
          snapshotDate: snapshot.snapshotDate,
          domainRating: snapshot.domainRating,
          referringDomains: snapshot.referringDomains,
          backlinks: snapshot.backlinks,
          organicTraffic: snapshot.organicTraffic,
          organicKeywords: snapshot.organicKeywords,
          organicKeywordsTop3: snapshot.organicKeywordsTop3,
          trafficValue: snapshot.trafficValue,
          createdAt: snapshot.createdAt,
        },
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
