import { createClient } from "@/utils/supabase/server";
import { cookies } from "next/headers";
import type { Business } from "@/lib/types";

type EnrichmentNotes = {
  description?: string;
  sqft?: number;
};

type BusinessRow = {
  id: string;
  name: string;
  primary_category: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  business_metrics:
    | {
        estimated_annual_revenue: number | string | null;
        estimated_value_mid: number | string | null;
      }[]
    | null;
  business_enrichment:
    | {
        employee_count_estimate: number | null;
        founded_year: number | null;
        notes: string | null;
      }[]
    | null;
};

function parseEnrichmentNotes(notes: string | null): EnrichmentNotes {
  if (!notes) {
    return {};
  }

  try {
    return JSON.parse(notes) as EnrichmentNotes;
  } catch {
    return { description: notes };
  }
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) {
    return fallback;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapBusinessRow(row: BusinessRow): Business {
  const metrics = row.business_metrics?.[0];
  const enrichment = row.business_enrichment?.[0];
  const notes = parseEnrichmentNotes(enrichment?.notes ?? null);

  return {
    id: row.id,
    name: row.name,
    category: row.primary_category ?? "Uncategorized",
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    lat: toNumber(row.latitude),
    lng: toNumber(row.longitude),
    vestimate: toNumber(metrics?.estimated_value_mid),
    annualRevenue: toNumber(metrics?.estimated_annual_revenue),
    employees: enrichment?.employee_count_estimate ?? 0,
    founded: enrichment?.founded_year ?? 0,
    sqft: notes.sqft ?? 0,
    description: notes.description ?? "",
  };
}

export async function getBusinesses(): Promise<Business[]> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("businesses")
    .select(
      `
      id,
      name,
      primary_category,
      address,
      city,
      state,
      latitude,
      longitude,
      business_metrics (
        estimated_annual_revenue,
        estimated_value_mid
      ),
      business_enrichment (
        employee_count_estimate,
        founded_year,
        notes
      )
    `,
    )
    .eq("is_active", true)
    .eq("is_qualified", true)
    .order("name");

  if (error) {
    throw new Error(`Failed to load businesses: ${error.message}`);
  }

  return (data as BusinessRow[]).map(mapBusinessRow);
}
