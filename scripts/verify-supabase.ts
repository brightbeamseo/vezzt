import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error("Missing Supabase env vars in .env.local");
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("businesses")
    .select(
      `
      id,
      name,
      primary_category,
      business_metrics (estimated_value_mid),
      business_enrichment (employee_count_estimate, notes)
    `,
    )
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(`Query failed: ${error.message}`);
  }

  console.log(`Loaded ${data?.length ?? 0} businesses from Supabase`);
  for (const row of data ?? []) {
    console.log(`- ${row.name} (${row.primary_category})`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
