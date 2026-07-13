import { config } from "dotenv";
import { lookup } from "node:dns/promises";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Client } from "pg";
import { businesses } from "../src/lib/businesses";
import type { Business } from "../src/lib/types";

config({ path: ".env.local" });

type SeedReview = {
  reviewCount: number;
  averageRating: number;
};

const SEED_REVIEWS: Record<string, SeedReview> = {
  "1": { reviewCount: 248, averageRating: 4.7 },
  "2": { reviewCount: 412, averageRating: 4.5 },
  "3": { reviewCount: 186, averageRating: 4.8 },
  "4": { reviewCount: 132, averageRating: 4.6 },
  "5": { reviewCount: 523, averageRating: 4.9 },
  "6": { reviewCount: 301, averageRating: 4.4 },
};

const READ_POLICIES_SQL = `
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'businesses'
      and policyname = 'Allow anon read on businesses'
  ) then
    create policy "Allow anon read on businesses"
      on public.businesses for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_metrics'
      and policyname = 'Allow anon read on business_metrics'
  ) then
    create policy "Allow anon read on business_metrics"
      on public.business_metrics for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_enrichment'
      and policyname = 'Allow anon read on business_enrichment'
  ) then
    create policy "Allow anon read on business_enrichment"
      on public.business_enrichment for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'review_snapshots'
      and policyname = 'Allow anon read on review_snapshots'
  ) then
    create policy "Allow anon read on review_snapshots"
      on public.review_snapshots for select to anon, authenticated using (true);
  end if;
end $$;
`;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function demoGooglePlaceId(business: Business): string {
  return `demo:${business.id}-${slugify(business.name)}`;
}

function getProjectRef(): string {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local.");
  }

  return new URL(supabaseUrl).hostname.split(".")[0];
}

async function getDatabaseUrls(): Promise<string[]> {
  if (process.env.SUPABASE_DB_URL) {
    return [process.env.SUPABASE_DB_URL];
  }

  const password = process.env.SUPABASE_DATABASE_PASS;
  if (!password) {
    throw new Error("Missing SUPABASE_DATABASE_PASS in .env.local.");
  }

  const projectRef = getProjectRef();
  const encodedPassword = encodeURIComponent(password);
  const urls: string[] = [];

  try {
    const { address } = await lookup(`db.${projectRef}.supabase.co`, { family: 6 });
    urls.push(
      `postgresql://postgres:${encodedPassword}@[${address}]:5432/postgres`,
    );
  } catch {
    // Fall back to hostname-based URLs when IPv6 resolution is unavailable.
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
        // ignore cleanup errors between attempts
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Unable to connect to Supabase Postgres.");
}

function getAdminSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !secretKey) {
    return null;
  }

  return createSupabaseClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name = $1
    ) as exists`,
    [tableName],
  );

  return rows[0]?.exists ?? false;
}

async function ensureReadPolicies(client: Client): Promise<void> {
  await client.query(READ_POLICIES_SQL);
  console.log("Ensured Supabase read policies are in place.");
}

async function seedBusinessWithPg(
  client: Client,
  business: Business,
): Promise<string> {
  const googlePlaceId = demoGooglePlaceId(business);
  const review = SEED_REVIEWS[business.id] ?? {
    reviewCount: 100,
    averageRating: 4.5,
  };

  const { rows } = await client.query<{ id: string }>(
    `insert into public.businesses (
      google_place_id,
      name,
      primary_category,
      address,
      city,
      state,
      country,
      latitude,
      longitude,
      is_active,
      last_seen_at
    ) values ($1, $2, $3, $4, $5, $6, 'US', $7, $8, true, now())
    on conflict (google_place_id) do update set
      name = excluded.name,
      primary_category = excluded.primary_category,
      address = excluded.address,
      city = excluded.city,
      state = excluded.state,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      is_active = true,
      last_seen_at = now(),
      updated_at = now()
    returning id`,
    [
      googlePlaceId,
      business.name,
      business.category,
      business.address,
      business.city,
      business.state,
      business.lat,
      business.lng,
    ],
  );

  const businessId = rows[0].id;

  await client.query(
    `insert into public.review_snapshots (
      business_id,
      snapshot_date,
      review_count,
      average_rating,
      source
    ) values ($1, current_date, $2, $3, 'google')
    on conflict (business_id, snapshot_date, source) do update set
      review_count = excluded.review_count,
      average_rating = excluded.average_rating`,
    [businessId, review.reviewCount, review.averageRating],
  );

  const reviews30d = Math.max(1, Math.round(review.reviewCount * 0.04));
  const reviews90d = Math.max(reviews30d, Math.round(review.reviewCount * 0.1));
  const reviews12mo = Math.max(reviews90d, Math.round(review.reviewCount * 0.35));

  await client.query(
    `insert into public.business_metrics (
      business_id,
      reviews_30d,
      reviews_90d,
      reviews_12mo,
      review_velocity_monthly,
      rating_change_90d,
      estimated_annual_revenue,
      estimated_value_low,
      estimated_value_mid,
      estimated_value_high,
      confidence_score,
      acquisition_score
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    on conflict (business_id) do update set
      reviews_30d = excluded.reviews_30d,
      reviews_90d = excluded.reviews_90d,
      reviews_12mo = excluded.reviews_12mo,
      review_velocity_monthly = excluded.review_velocity_monthly,
      rating_change_90d = excluded.rating_change_90d,
      estimated_annual_revenue = excluded.estimated_annual_revenue,
      estimated_value_low = excluded.estimated_value_low,
      estimated_value_mid = excluded.estimated_value_mid,
      estimated_value_high = excluded.estimated_value_high,
      confidence_score = excluded.confidence_score,
      acquisition_score = excluded.acquisition_score,
      updated_at = now()`,
    [
      businessId,
      reviews30d,
      reviews90d,
      reviews12mo,
      reviews90d / 3,
      0.1,
      business.annualRevenue,
      Math.round(business.vestimate * 0.85),
      business.vestimate,
      Math.round(business.vestimate * 1.15),
      0.65,
      72,
    ],
  );

  await client.query(
    `insert into public.business_enrichment (
      business_id,
      employee_count_estimate,
      founded_year,
      notes
    ) values ($1, $2, $3, $4)
    on conflict (business_id) do update set
      employee_count_estimate = excluded.employee_count_estimate,
      founded_year = excluded.founded_year,
      notes = excluded.notes,
      updated_at = now()`,
    [
      businessId,
      business.employees,
      business.founded,
      JSON.stringify({
        description: business.description,
        sqft: business.sqft,
        seedSource: "businesses.ts",
        legacyId: business.id,
      }),
    ],
  );

  return businessId;
}

async function seedBusinessWithSupabase(
  supabase: ReturnType<typeof createSupabaseClient>,
  business: Business,
): Promise<string> {
  const googlePlaceId = demoGooglePlaceId(business);
  const review = SEED_REVIEWS[business.id] ?? {
    reviewCount: 100,
    averageRating: 4.5,
  };

  const { data: businessRow, error: businessError } = await supabase
    .from("businesses")
    .upsert(
      {
        google_place_id: googlePlaceId,
        name: business.name,
        primary_category: business.category,
        address: business.address,
        city: business.city,
        state: business.state,
        country: "US",
        latitude: business.lat,
        longitude: business.lng,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "google_place_id" },
    )
    .select("id")
    .single();

  if (businessError || !businessRow) {
    throw new Error(
      `Failed to upsert ${business.name}: ${businessError?.message ?? "unknown error"}`,
    );
  }

  const businessId = businessRow.id as string;
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const reviews30d = Math.max(1, Math.round(review.reviewCount * 0.04));
  const reviews90d = Math.max(reviews30d, Math.round(review.reviewCount * 0.1));
  const reviews12mo = Math.max(reviews90d, Math.round(review.reviewCount * 0.35));

  const { error: snapshotError } = await supabase.from("review_snapshots").upsert(
    {
      business_id: businessId,
      snapshot_date: snapshotDate,
      review_count: review.reviewCount,
      average_rating: review.averageRating,
      source: "google",
    },
    { onConflict: "business_id,snapshot_date,source" },
  );

  if (snapshotError) {
    throw new Error(`Failed to upsert review snapshot: ${snapshotError.message}`);
  }

  const { error: metricsError } = await supabase.from("business_metrics").upsert(
    {
      business_id: businessId,
      reviews_30d: reviews30d,
      reviews_90d: reviews90d,
      reviews_12mo: reviews12mo,
      review_velocity_monthly: reviews90d / 3,
      rating_change_90d: 0.1,
      estimated_annual_revenue: business.annualRevenue,
      estimated_value_low: Math.round(business.vestimate * 0.85),
      estimated_value_mid: business.vestimate,
      estimated_value_high: Math.round(business.vestimate * 1.15),
      confidence_score: 0.65,
      acquisition_score: 72,
    },
    { onConflict: "business_id" },
  );

  if (metricsError) {
    throw new Error(`Failed to upsert business metrics: ${metricsError.message}`);
  }

  const { error: enrichmentError } = await supabase.from("business_enrichment").upsert(
    {
      business_id: businessId,
      employee_count_estimate: business.employees,
      founded_year: business.founded,
      notes: JSON.stringify({
        description: business.description,
        sqft: business.sqft,
        seedSource: "businesses.ts",
        legacyId: business.id,
      }),
    },
    { onConflict: "business_id" },
  );

  if (enrichmentError) {
    throw new Error(`Failed to upsert business enrichment: ${enrichmentError.message}`);
  }

  return businessId;
}

async function main() {
  const adminClient = getAdminSupabaseClient();

  if (adminClient) {
    console.log("Seeding via Supabase secret key...");

    const hasProprietaryScores = false;
    console.log(
      hasProprietaryScores
        ? "proprietary_scores table found — no seed mapping yet, skipping."
        : "proprietary_scores table not found — skipping.",
    );

    for (const business of businesses) {
      await seedBusinessWithSupabase(adminClient, business);
      console.log(`Seeded ${business.name} (${demoGooglePlaceId(business)})`);
    }

    console.log(`Done. Upserted ${businesses.length} businesses.`);
    return;
  }

  const client = await connectClient();

  try {
    await ensureReadPolicies(client);

    const hasProprietaryScores = await tableExists(client, "proprietary_scores");
    console.log(
      hasProprietaryScores
        ? "proprietary_scores table found — no seed mapping yet, skipping."
        : "proprietary_scores table not found — skipping.",
    );

    for (const business of businesses) {
      await seedBusinessWithPg(client, business);
      console.log(`Seeded ${business.name} (${demoGooglePlaceId(business)})`);
    }

    console.log(`Done. Upserted ${businesses.length} businesses.`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
