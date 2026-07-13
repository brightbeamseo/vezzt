import { NextResponse } from "next/server";
import { startPlaceIdMonitorRun } from "@/lib/apify-monitor-start";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Weekly Tier 1 Place-ID monitoring (100+ reviews).
 * No broad search — known google_place_id values only.
 */
export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!cronSecret || auth !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await startPlaceIdMonitorRun({ tier: 1 });
    return NextResponse.json({
      ...result,
      note: "Webhook imports snapshots on success; no new businesses created",
    });
  } catch (error) {
    console.error("weekly_roofing_monitor_failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Monitor start failed",
      },
      { status: 500 },
    );
  }
}
