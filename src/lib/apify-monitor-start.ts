import { connectAdminPg } from "@/lib/admin-db";

export type PlaceIdMonitorOptions = {
  marketId?: string;
  /** 1 = weekly (100+), 2 = monthly (<100) */
  tier: 1 | 2;
  mode?: "monitor";
};

export type PlaceIdMonitorStartResult =
  | {
      ok: true;
      started: false;
      message: string;
      placeIdCount: 0;
    }
  | {
      ok: true;
      started: true;
      mode: "monitor";
      tier: 1 | 2;
      placeIdCount: number;
      runId: string;
      datasetId: string;
      uniqueness: "google_place_id";
    };

function apifyToken(): string {
  const token =
    process.env.APIFY_TOKEN || process.env.APIFY_DEFAULT_API_TOKEN || "";
  if (!token) throw new Error("Missing APIFY_TOKEN");
  return token;
}

/**
 * Start an Apify Place-ID refresh for known roofing businesses in a monitoring tier.
 * Does not run broad market search. Never creates new businesses (webhook mode=monitor).
 */
export async function startPlaceIdMonitorRun(
  options: PlaceIdMonitorOptions,
): Promise<PlaceIdMonitorStartResult> {
  const marketId = options.marketId ?? process.env.VEZZT_MARKET ?? "boise-metro";
  const webhookSecret = process.env.APIFY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    throw new Error("Missing APIFY_WEBHOOK_SECRET");
  }

  const client = await connectAdminPg();
  try {
    const { rows } = await client.query<{
      google_place_id: string;
      name: string;
    }>(
      `select b.google_place_id, b.name
       from public.businesses b
       join public.markets m on m.id = b.market_id
       where m.market_slug = $1
         and b.target_sector = 'roofing'
         and b.qualification_status in ('qualified', 'below_threshold')
         and b.monitoring_tier = $2
         and b.google_place_id is not null
       order by b.name`,
      [marketId, options.tier],
    );

    if (rows.length === 0) {
      return {
        ok: true,
        started: false,
        message: `No Tier ${options.tier} Roofing contractor businesses to monitor`,
        placeIdCount: 0,
      };
    }

    const placeIds = rows.map((r) => r.google_place_id);
    const searchStringsArray = placeIds.map((id) => `place_id:${id}`);
    const base =
      process.env.VEZZT_PUBLIC_URL || "https://vezzt.vercel.app";
    const webhookUrl = `${base.replace(/\/$/, "")}/api/apify/run-complete?mode=monitor`;

    const webhooksB64 = Buffer.from(
      JSON.stringify([
        {
          eventTypes: ["ACTOR.RUN.SUCCEEDED"],
          requestUrl: webhookUrl,
          headersTemplate: JSON.stringify({
            "Content-Type": "application/json",
            "x-apify-webhook-secret": webhookSecret,
          }),
        },
      ]),
    ).toString("base64");

    const token = apifyToken();
    const startUrl = new URL(
      "https://api.apify.com/v2/acts/compass~crawler-google-places/runs",
    );
    startUrl.searchParams.set("token", token);
    startUrl.searchParams.set("webhooks", webhooksB64);

    const start = await fetch(startUrl.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray,
        maxCrawledPlacesPerSearch: 1,
        language: "en",
        scrapePlaceDetailPage: true,
        maxReviews: 0,
        maxImages: 0,
      }),
    });

    if (!start.ok) {
      const text = await start.text();
      throw new Error(`Apify start failed: ${start.status} ${text}`);
    }

    const json = (await start.json()) as {
      data: { id: string; defaultDatasetId: string };
    };

    return {
      ok: true,
      started: true,
      mode: "monitor",
      tier: options.tier,
      placeIdCount: placeIds.length,
      runId: json.data.id,
      datasetId: json.data.defaultDatasetId,
      uniqueness: "google_place_id",
    };
  } finally {
    await client.end();
  }
}
