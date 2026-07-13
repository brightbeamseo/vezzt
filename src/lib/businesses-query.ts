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
  qualification_status: string | null;
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
  review_snapshots:
    | {
        review_count: number | null;
        snapshot_date: string;
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

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapBusinessRow(row: BusinessRow): Business {
  const metrics = row.business_metrics?.[0];
  const enrichment = row.business_enrichment?.[0];
  const notes = parseEnrichmentNotes(enrichment?.notes ?? null);
  const snapshots = [...(row.review_snapshots ?? [])].sort((a, b) =>
    a.snapshot_date < b.snapshot_date ? 1 : -1,
  );
  const latest = snapshots[0];

  return {
    id: row.id,
    name: row.name,
    category: row.primary_category ?? "Uncategorized",
    address: row.address ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    lat: toNumber(row.latitude) ?? 0,
    lng: toNumber(row.longitude) ?? 0,
    vestimate: toNumber(metrics?.estimated_value_mid),
    annualRevenue: toNumber(metrics?.estimated_annual_revenue),
    employees: enrichment?.employee_count_estimate ?? null,
    founded: enrichment?.founded_year ?? null,
    sqft: notes.sqft ?? null,
    description: notes.description ?? "",
    qualificationStatus: row.qualification_status,
    reviewCount: latest?.review_count ?? null,
  };
}

/** All active businesses for the internal map (not only is_qualified). */
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
      qualification_status,
      business_metrics (
        estimated_annual_revenue,
        estimated_value_mid
      ),
      business_enrichment (
        employee_count_estimate,
        founded_year,
        notes
      ),
      review_snapshots (
        review_count,
        snapshot_date
      )
    `,
    )
    .eq("is_active", true)
    .order("name");

  if (error) {
    throw new Error(`Failed to load businesses: ${error.message}`);
  }

  return (data as BusinessRow[]).map(mapBusinessRow);
}
