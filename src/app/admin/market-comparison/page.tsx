import Link from "next/link";
import { MarketComparisonDashboard } from "@/components/market-comparison-dashboard";
import { getMarketComparisonSignals } from "@/lib/market-comparison";
import { DEFAULT_MARKET_COMPARISON_FILTERS } from "@/lib/market-comparison-types";
import { MARKETS } from "@/lib/markets";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{ market?: string; sector?: string }>;
};

export default async function MarketComparisonPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const marketId =
    params.market && params.market in MARKETS
      ? params.market
      : DEFAULT_MARKET_COMPARISON_FILTERS.marketId;
  const sector = params.sector ?? DEFAULT_MARKET_COMPARISON_FILTERS.sector;

  const payload = await getMarketComparisonSignals({ marketId, sector });

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Internal · Admin
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              Market Comparison
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-vezzt-200">
              Flattened current signals per business location — latest review,
              Ahrefs, and GeoGrid only. Future scores show “Not calculated”.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/dashboard/boise-roofing"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Boise Roofing cohort
            </Link>
            <Link
              href="/admin/qualification"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Qualification
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
        {payload.duplicateBusinessIds.length > 0 ? (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            Duplicate business rows detected in view:{" "}
            {payload.duplicateBusinessIds.join(", ")}
          </div>
        ) : null}
        <MarketComparisonDashboard payload={payload} />
      </main>
    </div>
  );
}
