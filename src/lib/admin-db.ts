import { Client } from "pg";

/**
 * Server-side Postgres client (bypasses RLS). Used for admin mutations.
 * Prefer Supabase JS for normal reads.
 */
export async function connectAdminPg(): Promise<Client> {
  if (process.env.SUPABASE_DB_URL) {
    const client = new Client({
      connectionString: process.env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    return client;
  }

  const password = process.env.SUPABASE_DATABASE_PASS;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!password || !supabaseUrl) {
    throw new Error("Missing database credentials");
  }

  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const encoded = encodeURIComponent(password);
  const urls = [
    `postgresql://postgres.${projectRef}:${encoded}@aws-1-us-east-2.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${projectRef}:${encoded}@aws-1-us-east-2.pooler.supabase.com:6543/postgres`,
  ];

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

  throw lastError instanceof Error ? lastError : new Error("DB connect failed");
}
