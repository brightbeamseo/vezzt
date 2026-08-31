import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getOpportunityMarketByIdOrSlug } from "@/lib/opportunity-queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ marketId: string }>;
};

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-vezzt-950">{value}</dd>
    </div>
  );
}

function formatInt(n: number | null): string {
  if (n === null) return "Unavailable";
  return n.toLocaleString("en-US");
}

function formatPct(n: number | null): string {
  if (n === null) return "Unavailable";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatRate(n: number | null): string {
  if (n === null) return "Unavailable";
  return `${n.toFixed(1)}%`;
}

function formatShare(n: number | null): string {
  if (n === null) return "Unavailable";
  return `${(n * 100).toFixed(1)}%`;
}

function formatMoney(n: number | null): string {
  if (n === null) return "Unavailable";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export default async function MarketOpportunityDetailPage({
  params,
}: PageProps) {
  const { marketId } = await params;
  const market = await getOpportunityMarketByIdOrSlug(marketId);
  if (!market) notFound();

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Market Opportunity
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              {market.marketName}
            </h1>
            <p className="mt-1 text-sm text-vezzt-200">
              {market.states.join(" · ") || "—"}
              {market.datasetYear
                ? ` · ACS 5-Year ${market.datasetYear}`
                : ""}
            </p>
          </div>
          <Link
            href="/admin/market-opportunity"
            className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
          >
            ← All markets
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Market Definition
          </h2>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Market name" value={market.marketName} />
            <Field label="Slug" value={market.marketSlug} />
            <Field
              label="State(s)"
              value={market.states.join(", ") || "—"}
            />
            <Field label="Timezone" value={market.timezone || "—"} />
            <Field label="CBSA code" value={market.cbsaCode || "—"} />
            <Field
              label="Census geography"
              value={market.geographyName || "—"}
            />
            <Field
              label="Center coordinates"
              value={
                market.centerLat != null && market.centerLng != null
                  ? `${market.centerLat}, ${market.centerLng}`
                  : "—"
              }
            />
            <Field
              label="Type"
              value={market.marketType || "—"}
            />
          </dl>
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Included cities / localities
            </h3>
            <ul className="mt-2 space-y-1 text-sm text-vezzt-950">
              {market.localities.map((l) => (
                <li key={l.id}>
                  {l.cityName}, {l.state}
                  {l.latitude != null && l.longitude != null
                    ? ` (${l.latitude}, ${l.longitude})`
                    : ""}
                </li>
              ))}
              {market.localities.length === 0 ? (
                <li className="text-neutral-500">No localities configured.</li>
              ) : null}
            </ul>
          </div>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">Demographics</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Source: {market.dataSource || "US Census ACS"}
            {market.baselineDatasetYear && market.datasetYear
              ? ` · Growth compares ACS ${market.baselineDatasetYear} → ${market.datasetYear}`
              : ""}
            {market.lastUpdated
              ? ` · Updated ${new Date(market.lastUpdated).toLocaleString("en-US")}`
              : ""}
            . These are ACS multi-year estimates, not live population counts.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Field label="Population" value={formatInt(market.population)} />
            <Field
              label="Population growth"
              value={formatPct(market.populationGrowth)}
            />
            <Field label="Households" value={formatInt(market.households)} />
            <Field
              label="Household growth"
              value={formatPct(market.householdGrowth)}
            />
            <Field
              label="Owner-occupied households"
              value={formatInt(market.ownerOccupiedUnits)}
            />
            <Field
              label="Homeownership rate"
              value={formatRate(market.ownerOccupiedRate)}
            />
            <Field
              label="Owner-occ HH / 1k residents"
              value={
                market.ownerOccupiedPer1kResidents == null
                  ? "Unavailable"
                  : market.ownerOccupiedPer1kResidents.toFixed(1)
              }
            />
            <Field
              label="Median household income"
              value={formatMoney(market.medianHouseholdIncome)}
            />
            <Field
              label="Median home value"
              value={formatMoney(market.medianHomeValue)}
            />
            <Field
              label="Housing units"
              value={formatInt(market.housingUnits)}
            />
            <Field
              label="Housing-unit growth"
              value={formatPct(market.housingGrowth)}
            />
            <Field
              label="1-unit detached (SF)"
              value={formatInt(market.singleFamilyDetachedUnits)}
            />
            <Field
              label="Single-family share"
              value={formatShare(market.singleFamilyShare)}
            />
            <Field
              label="Median year structure built"
              value={
                market.medianYearStructureBuilt == null
                  ? "Unavailable"
                  : String(Math.round(market.medianYearStructureBuilt))
              }
            />
          </dl>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">Competition</h2>
          <p className="mt-2 text-sm text-neutral-600">Not calculated</p>
          <p className="mt-1 text-xs text-neutral-500">
            Phase 2 will add fresh Google Maps / GBP roofing discovery for this
            market.
          </p>
        </section>

        <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-vezzt-950">
            Opportunity Score
          </h2>
          <p className="mt-2 text-sm text-neutral-600">Not calculated</p>
          <p className="mt-1 text-xs text-neutral-500">
            Scoring weights will be decided after reviewing raw demographic and
            competition data.
          </p>
        </section>
      </main>
    </div>
  );
}
