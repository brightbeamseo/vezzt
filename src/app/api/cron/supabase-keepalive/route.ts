import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { connectAdminPg } from "@/lib/admin-db";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Daily ping so the Supabase project does not pause from inactivity.
 * Supabase counts real database queries — not dashboard visits.
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

  const result: {
    ok: boolean;
    ts: string;
    postgres: { ok: boolean; businesses: number | null; error?: string };
    rest: { ok: boolean; businesses: number | null; error?: string };
  } = {
    ok: false,
    ts: new Date().toISOString(),
    postgres: { ok: false, businesses: null },
    rest: { ok: false, businesses: null },
  };

  // Direct Postgres query — strongest keepalive signal for Supabase inactivity checks.
  try {
    const db = await connectAdminPg();
    try {
      const r = await db.query<{ businesses: number }>(
        "select count(*)::int as businesses from public.businesses",
      );
      result.postgres = {
        ok: true,
        businesses: r.rows[0]?.businesses ?? null,
      };
    } finally {
      await db.end();
    }
  } catch (error) {
    result.postgres = {
      ok: false,
      businesses: null,
      error: error instanceof Error ? error.message : "Postgres keepalive failed",
    };
  }

  // REST API read as secondary signal (matches Supabase docs examples).
  if (url && key) {
    try {
      const supabase = createClient(url, key);
      const { count, error } = await supabase
        .from("businesses")
        .select("id", { count: "exact", head: true });

      if (error) throw new Error(error.message);
      result.rest = { ok: true, businesses: count ?? null };
    } catch (error) {
      result.rest = {
        ok: false,
        businesses: null,
        error: error instanceof Error ? error.message : "REST keepalive failed",
      };
    }
  } else {
    result.rest = { ok: false, businesses: null, error: "Missing Supabase env" };
  }

  result.ok = result.postgres.ok || result.rest.ok;

  if (!result.ok) {
    console.error("supabase_keepalive_failed", result);
    return NextResponse.json(result, { status: 500 });
  }

  console.info("supabase_keepalive_ok", result);
  return NextResponse.json(result);
}
