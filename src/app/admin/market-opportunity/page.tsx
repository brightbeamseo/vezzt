import Link from "next/link";
import { MarketOpportunityTable } from "@/components/market-opportunity-table";
import { getOpportunityMarkets } from "@/lib/opportunity-queries";

export const dynamic = "force-dynamic";

export default async function MarketOpportunityPage() {
  const rows = await getOpportunityMarkets();

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Internal · Admin
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              Market Opportunity
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-vezzt-200">
              Phase 1 demographic screening for Western roofing expansion
              markets. Raw Census metrics only — no opportunity score yet.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/market-comparison"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Market Comparison
            </Link>
            <Link
              href="/dashboard/boise-roofing"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Boise Roofing
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
        <MarketOpportunityTable rows={rows} />
      </main>
    </div>
  );
}
