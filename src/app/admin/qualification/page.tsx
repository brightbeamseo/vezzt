import Link from "next/link";
import { listAdminBusinesses } from "@/app/admin/qualification/actions";
import { QualificationAdminTable } from "@/components/qualification-admin-table";
import { DEFAULT_REVIEW_THRESHOLD } from "@/lib/qualification";

export const dynamic = "force-dynamic";

export default async function QualificationAdminPage() {
  const threshold = Number(
    process.env.VEZZT_MIN_REVIEW_COUNT ?? DEFAULT_REVIEW_THRESHOLD,
  );
  const businesses = await listAdminBusinesses();

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-6 py-4 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-vezzt-300">
              Internal
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              Business qualification
            </h1>
            <p className="mt-1 text-sm text-vezzt-200">
              Roofing MVP — review Apify imports, approve or reject borderline
              rows.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
          >
            Back to map
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <QualificationAdminTable
          businesses={businesses}
          threshold={Number.isFinite(threshold) ? threshold : DEFAULT_REVIEW_THRESHOLD}
        />
      </main>
    </div>
  );
}
