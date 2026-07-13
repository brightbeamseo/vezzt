"use server";

import { auth } from "@/auth";
import { connectAdminPg } from "@/lib/admin-db";
import type { QualificationStatus } from "@/lib/qualification";
import { revalidatePath } from "next/cache";

export type AdminBusinessRow = {
  id: string;
  name: string;
  primaryCategory: string | null;
  secondaryCategories: string[] | null;
  websiteUrl: string | null;
  reviewCount: number | null;
  qualificationStatus: QualificationStatus;
  qualificationReason: string | null;
  qualificationConfidence: number | null;
  targetSector: string | null;
  reviewThresholdMet: boolean;
  isQualified: boolean;
};

export async function listAdminBusinesses(): Promise<AdminBusinessRow[]> {
  const session = await auth();
  if (!session) {
    throw new Error("Unauthorized");
  }

  const client = await connectAdminPg();
  try {
    const { rows } = await client.query<{
      id: string;
      name: string;
      primary_category: string | null;
      secondary_categories: string[] | null;
      website_url: string | null;
      review_count: number | null;
      qualification_status: QualificationStatus;
      qualification_reason: string | null;
      qualification_confidence: string | number | null;
      target_sector: string | null;
      review_threshold_met: boolean;
      is_qualified: boolean;
    }>(
      `
      select
        b.id,
        b.name,
        b.primary_category,
        b.secondary_categories,
        b.website_url,
        b.qualification_status,
        b.qualification_reason,
        b.qualification_confidence,
        b.target_sector,
        b.review_threshold_met,
        b.is_qualified,
        (
          select rs.review_count
          from public.review_snapshots rs
          where rs.business_id = b.id
          order by rs.snapshot_date desc
          limit 1
        ) as review_count
      from public.businesses b
      where exists (
        select 1
        from public.review_snapshots rs
        where rs.business_id = b.id
          and rs.source = 'google_apify'
      )
      order by
        case b.qualification_status
          when 'manual_review' then 0
          when 'below_threshold' then 1
          when 'qualified' then 2
          else 3
        end,
        b.name
      `,
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      primaryCategory: row.primary_category,
      secondaryCategories: row.secondary_categories,
      websiteUrl: row.website_url,
      reviewCount: row.review_count,
      qualificationStatus: row.qualification_status,
      qualificationReason: row.qualification_reason,
      qualificationConfidence:
        row.qualification_confidence === null
          ? null
          : Number(row.qualification_confidence),
      targetSector: row.target_sector,
      reviewThresholdMet: row.review_threshold_met,
      isQualified: row.is_qualified,
    }));
  } finally {
    await client.end();
  }
}

export async function setManualQualification(
  businessId: string,
  decision: "approve" | "reject",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!businessId) {
    return { ok: false, error: "Missing business id" };
  }

  const client = await connectAdminPg();
  try {
    if (decision === "approve") {
      await client.query(
        `
        update public.businesses set
          qualification_status = 'qualified',
          is_qualified = true,
          review_threshold_met = coalesce(review_threshold_met, false),
          target_sector = coalesce(target_sector, 'roofing'),
          qualification_confidence = 1,
          qualification_reason = trim(both from concat(
            coalesce(qualification_reason, ''),
            case when qualification_reason is null or qualification_reason = '' then '' else ' | ' end,
            'Manual approve'
          )),
          updated_at = now()
        where id = $1
        `,
        [businessId],
      );
    } else {
      await client.query(
        `
        update public.businesses set
          qualification_status = 'excluded',
          is_qualified = false,
          qualification_confidence = 1,
          qualification_reason = trim(both from concat(
            coalesce(qualification_reason, ''),
            case when qualification_reason is null or qualification_reason = '' then '' else ' | ' end,
            'Manual reject'
          )),
          updated_at = now()
        where id = $1
        `,
        [businessId],
      );
    }

    revalidatePath("/admin/qualification");
    revalidatePath("/");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Update failed",
    };
  } finally {
    await client.end();
  }
}
