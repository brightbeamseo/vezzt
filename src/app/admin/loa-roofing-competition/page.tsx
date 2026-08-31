import Link from "next/link";
import { LoaCompetitionTable } from "@/components/loa-competition-table";
import { getLoaCompetitionRows } from "@/lib/loa-competition-queries";

export const dynamic = "force-dynamic";

export default async function LoaRoofingCompetitionPage() {
  const rows = await getLoaCompetitionRows();

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Internal · Admin
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              LOA Roofing Competition
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-vezzt-200">
              Phase IIIB dataset for the expansion report. Primary roofing GBPs
              within 15 miles, review thresholds, and owner-HH ratios. No
              Opportunity Score yet.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/local-opportunity-areas"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Local opportunity areas
            </Link>
            <Link
              href="/admin/market-opportunity"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Macro markets
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Map
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6">
        <LoaCompetitionTable rows={rows} />
      </main>
    </div>
  );
}
