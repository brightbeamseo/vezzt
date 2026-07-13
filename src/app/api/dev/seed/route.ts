import { readFileSync } from "node:fs";
import { join } from "node:path";
import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";
import { Client } from "pg";

export const runtime = "nodejs";

async function getDatabaseUrls(): Promise<string[]> {
  if (process.env.SUPABASE_DB_URL) {
    return [process.env.SUPABASE_DB_URL];
  }

  const password = process.env.SUPABASE_DATABASE_PASS;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!password || !supabaseUrl) {
    throw new Error(
      "Missing SUPABASE_DATABASE_PASS or NEXT_PUBLIC_SUPABASE_URL.",
    );
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const encodedPassword = encodeURIComponent(password);
  const urls: string[] = [];

  try {
    const { address } = await lookup(`db.${projectRef}.supabase.co`, { family: 6 });
    urls.push(
      `postgresql://postgres:${encodedPassword}@[${address}]:5432/postgres`,
    );
  } catch {
    // ignore
  }

  urls.push(
    `postgresql://postgres:${encodedPassword}@db.${projectRef}.supabase.co:5432/postgres`,
    `postgresql://postgres.${projectRef}:${encodedPassword}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:${encodedPassword}@aws-1-us-east-2.pooler.supabase.com:6543/postgres`,
    `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-us-east-2.pooler.supabase.com:6543/postgres`,
  );

  return urls;
}

async function connectClient(): Promise<Client> {
  const urls = await getDatabaseUrls();
  let lastError: unknown;

  for (const connectionString of urls) {
    const client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });

    try {
      await client.connect();
      return client;
    } catch (error) {
      lastError = error;
      try {
        await client.end();
      } catch {
        // ignore
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to connect to Supabase Postgres.");
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production." }, { status: 404 });
  }

  const files = [
    "supabase/migrations/20250630130100_anon_read_policies.sql",
    "supabase/migrations/20250630130200_seed_demo_businesses.sql",
  ];

  const client = await connectClient();

  try {
    for (const file of files) {
      const sql = readFileSync(join(process.cwd(), file), "utf8");
      await client.query(sql);
    }

    const { rows } = await client.query<{ count: string }>(
      "select count(*)::text as count from public.businesses where is_active = true",
    );

    return NextResponse.json({
      ok: true,
      businesses: Number(rows[0]?.count ?? 0),
    });
  } finally {
    await client.end();
  }
}
