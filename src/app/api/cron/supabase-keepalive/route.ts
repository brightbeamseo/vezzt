import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Daily ping so the Supabase project does not pause from inactivity.
 * Invoked by Vercel Cron (Authorization: Bearer CRON_SECRET).
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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase env" },
      { status: 500 },
    );
  }

  try {
    const supabase = createClient(url, key);
    const { count, error } = await supabase
      .from("businesses")
      .select("id", { count: "exact", head: true });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({
      ok: true,
      ts: new Date().toISOString(),
      businesses: count ?? null,
    });
  } catch (error) {
    console.error("supabase_keepalive_failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Keepalive failed",
      },
      { status: 500 },
    );
  }
}
