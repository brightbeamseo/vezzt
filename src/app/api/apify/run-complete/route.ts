import { NextResponse } from "next/server";
import { importApifyRunToSupabase } from "@/lib/apify-import";

export const runtime = "nodejs";
export const maxDuration = 300;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function extractSecret(req: Request, body: Record<string, unknown>): string | null {
  const header =
    req.headers.get("x-apify-webhook-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    null;
  if (header) return header;

  const url = new URL(req.url);
  const querySecret = url.searchParams.get("secret");
  if (querySecret) return querySecret;

  if (typeof body.secret === "string") return body.secret;
  return null;
}

function extractRunIds(body: Record<string, unknown>): {
  runId: string | null;
  datasetId: string | null;
} {
  const resource = (body.resource ?? body) as Record<string, unknown>;
  const eventData = (body.eventData ?? {}) as Record<string, unknown>;

  const runId =
    (typeof resource.id === "string" && resource.id) ||
    (typeof body.runId === "string" && body.runId) ||
    (typeof eventData.actorRunId === "string" && eventData.actorRunId) ||
    null;

  const datasetId =
    (typeof resource.defaultDatasetId === "string" &&
      resource.defaultDatasetId) ||
    (typeof body.datasetId === "string" && body.datasetId) ||
    null;

  return { runId, datasetId };
}

function resolveMode(
  req: Request,
  body: Record<string, unknown>,
): "discovery" | "monitor" {
  const url = new URL(req.url);
  const q = url.searchParams.get("mode");
  if (q === "monitor" || q === "discovery") return q;
  if (body.mode === "monitor" || body.mode === "discovery") {
    return body.mode;
  }
  // Prefer monitor when payload hints at place_id scrape
  const input = (body.resource as { options?: { build?: string } } | undefined);
  void input;
  return "discovery";
}

/**
 * Apify webhook: POST /api/apify/run-complete?mode=monitor|discovery
 */
export async function POST(req: Request) {
  const expected = process.env.APIFY_WEBHOOK_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "APIFY_WEBHOOK_SECRET is not configured" },
      { status: 500 },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const provided = extractSecret(req, body);
  if (!provided || !timingSafeEqual(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId, datasetId } = extractRunIds(body);
  if (!runId) {
    return NextResponse.json(
      { error: "Missing Apify run ID in webhook payload" },
      { status: 400 },
    );
  }

  const mode = resolveMode(req, body);

  try {
    console.log(
      JSON.stringify({
        event: "apify_webhook_received",
        runId,
        datasetId,
        mode,
      }),
    );

    const stats = await importApifyRunToSupabase({
      runId,
      datasetId,
      marketId: process.env.VEZZT_MARKET ?? "boise-metro",
      mode,
    });

    console.log(
      JSON.stringify({
        event: "apify_import_complete",
        ...stats,
        failedRecords: stats.failedRecords.slice(0, 20),
      }),
    );

    return NextResponse.json({
      ok: true,
      mode: stats.mode,
      created: stats.created,
      updated: stats.updated,
      skippedDuplicates: stats.skippedDuplicates,
      skippedUnknownPlaceIds: stats.skippedUnknownPlaceIds,
      snapshotsCreated: stats.snapshotsCreated,
      snapshotsSkippedDuplicate: stats.snapshotsSkippedDuplicate,
      rejectedOutsideMarket: stats.rejectedOutsideMarket,
      sectorExcluded: stats.sectorExcluded,
      failed: stats.failed,
      scrapeRunId: stats.scrapeRunId,
      status: stats.status,
    });
  } catch (error) {
    console.error("apify_import_failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Import failed",
      },
      { status: 500 },
    );
  }
}
