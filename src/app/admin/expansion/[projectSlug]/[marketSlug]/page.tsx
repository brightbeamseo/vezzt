import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getExpansionMarketDetail } from "@/lib/expansion-queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ projectSlug: string; marketSlug: string }>;
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
  if (n === null) return "-";
  return n.toLocaleString("en-US");
}

function formatPct(n: number | null): string {
  if (n === null) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatRate(n: number | null): string {
  if (n === null) return "-";
  return `${n.toFixed(1)}%`;
}

function formatMoney(n: number | null): string {
  if (n === null) return "-";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatDecimal(n: number | null, digits = 1): string {
  if (n === null) return "-";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-sm text-neutral-600">{children}</p>;
}

function Section({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-semibold text-vezzt-950">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
      {children}
    </section>
  );
}

export default async function ExpansionMarketDetailPage({ params }: PageProps) {
  const { projectSlug, marketSlug } = await params;
  const result = await getExpansionMarketDetail(projectSlug, marketSlug);
  if (!result) notFound();

  const { project, market } = result;
  const hasDemographics =
    market.ownerOccupiedHouseholds != null ||
    market.population != null ||
    market.households != null;
  const hasEnvironment =
    market.treeCanopy != null ||
    market.rainfall != null ||
    market.stormIndicators != null;
  const hasCompetition =
    market.dedicatedCount != null || market.totalDiscovered != null;
  const hasScores = market.finalOpportunityScore != null;
  const hasZips = market.zipCodes.length > 0;
  const hasDigital = market.digitalObservations.length > 0;
  const hasCompetitors = market.competitors.length > 0;

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-5xl flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              {project.name}
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              {market.displayName}
            </h1>
            <p className="mt-1 text-sm text-vezzt-200">
              {market.state} · {market.status.replace(/_/g, " ")} ·{" "}
              {market.geographyType}
            </p>
          </div>
          <Link
            href={`/admin/expansion/${project.slug}`}
            className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
          >
            ← All markets
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6">
        <Section title="Market definition">
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Display name" value={market.displayName} />
            <Field label="Slug" value={market.slug} />
            <Field label="State" value={market.state} />
            <Field
              label="Status"
              value={
                <span className="capitalize">
                  {market.status.replace(/_/g, " ")}
                </span>
              }
            />
            <Field label="Geography type" value={market.geographyType} />
            <Field
              label="Geography methodology"
              value={market.geographyMethodology || "-"}
            />
            <Field
              label="Center coordinates"
              value={
                market.centerLat != null && market.centerLng != null
                  ? `${market.centerLat}, ${market.centerLng}`
                  : "-"
              }
            />
            <Field
              label="Radius (miles)"
              value={formatDecimal(market.radiusMiles, 1)}
            />
            <Field label="Notes" value={market.notes || "-"} />
          </dl>
        </Section>

        <Section
          title="ZIP coverage"
          hint="ZIP list is empty until geography is defined."
        >
          {hasZips ? (
            <ul className="mt-3 flex flex-wrap gap-2 text-sm text-vezzt-950">
              {market.zipCodes.map((zip) => (
                <li
                  key={zip}
                  className="rounded border border-neutral-200 bg-neutral-50 px-2 py-0.5 tabular-nums"
                >
                  {zip}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No ZIP codes assigned yet.</EmptyNote>
          )}
        </Section>

        <Section
          title="Demographics"
          hint={
            hasDemographics
              ? [
                  market.demoDataSource,
                  market.demoDatasetYear
                    ? `ACS ${market.demoDatasetYear}`
                    : null,
                  market.demoDataQuality
                    ? `quality: ${market.demoDataQuality}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              : "Not collected yet."
          }
        >
          {hasDemographics ? (
            <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Field label="Population" value={formatInt(market.population)} />
              <Field label="Households" value={formatInt(market.households)} />
              <Field
                label="Owner-occupied households"
                value={formatInt(market.ownerOccupiedHouseholds)}
              />
              <Field
                label="Homeownership rate"
                value={formatRate(market.homeownershipRate)}
              />
              <Field
                label="Single-family detached"
                value={formatInt(market.singleFamilyDetachedHomes)}
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
                label="Housing growth"
                value={formatPct(market.housingGrowth)}
              />
              <Field
                label="Household growth"
                value={formatPct(market.householdGrowth)}
              />
            </dl>
          ) : (
            <EmptyNote>
              Demographics will appear after Census / ACS collection.
            </EmptyNote>
          )}
        </Section>

        <Section
          title="Environment"
          hint={hasEnvironment ? undefined : "Not collected yet."}
        >
          {hasEnvironment ? (
            <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Field
                label="Tree canopy"
                value={formatDecimal(market.treeCanopy, 1)}
              />
              <Field
                label="Rainfall"
                value={formatDecimal(market.rainfall, 1)}
              />
              <Field
                label="Data quality"
                value={market.envDataQuality || "-"}
              />
            </dl>
          ) : (
            <EmptyNote>
              Environment signals (canopy, rainfall, storms) are not loaded.
            </EmptyNote>
          )}
        </Section>

        <Section
          title="Competition metrics"
          hint={
            hasCompetition
              ? [
                  market.competitionDataSource,
                  market.competitionMethodologyVersion
                    ? `method ${market.competitionMethodologyVersion}`
                    : null,
                  market.competitionDataQuality
                    ? `quality: ${market.competitionDataQuality}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || undefined
              : "Not calculated yet."
          }
        >
          {hasCompetition ? (
            <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Field
                label="Total discovered"
                value={formatInt(market.totalDiscovered)}
              />
              <Field
                label="Dedicated"
                value={formatInt(market.dedicatedCount)}
              />
              <Field
                label="Roofing / exterior"
                value={formatInt(market.roofingExteriorCount)}
              />
              <Field
                label="Cleaning / repair"
                value={formatInt(market.cleaningRepairCount)}
              />
              <Field
                label="100+ reviews"
                value={formatInt(market.reviews100Plus)}
              />
              <Field
                label="250+ reviews"
                value={formatInt(market.reviews250Plus)}
              />
              <Field
                label="500+ reviews"
                value={formatInt(market.reviews500Plus)}
              />
              <Field
                label="Owner HH / dedicated"
                value={formatDecimal(market.ownerHhPerDedicated, 0)}
              />
              <Field
                label="Top 5 avg reviews"
                value={formatDecimal(market.top5AvgReviews, 0)}
              />
            </dl>
          ) : (
            <EmptyNote>
              Competition rollups will appear after Maps discovery and
              classification.
            </EmptyNote>
          )}
        </Section>

        <Section
          title="Competitors"
          hint={
            hasCompetitors
              ? `${market.competitors.length} linked`
              : "No competitors linked yet."
          }
        >
          {hasCompetitors ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                    <th className="py-2 pr-3">Business</th>
                    <th className="py-2 pr-3">Classification</th>
                    <th className="py-2 pr-3 text-right">Rating</th>
                    <th className="py-2 text-right">Reviews</th>
                  </tr>
                </thead>
                <tbody>
                  {market.competitors.map((c) => (
                    <tr
                      key={c.placeId}
                      className="border-t border-neutral-100"
                    >
                      <td className="py-2 pr-3">
                        <div className="font-medium text-vezzt-950">
                          {c.businessName || c.placeId}
                        </div>
                        <div className="text-xs text-neutral-500">
                          {c.address || c.categoryName || "-"}
                        </div>
                      </td>
                      <td className="py-2 pr-3 capitalize text-neutral-700">
                        {(c.classification || "-").replace(/_/g, " ")}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatDecimal(c.rating, 1)}
                      </td>
                      <td className="py-2 text-right tabular-nums">
                        {formatInt(c.reviewsCount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyNote>
              Place-level competitor rows will list here after discovery.
            </EmptyNote>
          )}
        </Section>

        <Section
          title="Digital observations"
          hint="Manual Maps / organic / LSA / Ads notes."
        >
          {hasDigital ? (
            <ul className="mt-3 space-y-3">
              {market.digitalObservations.map((obs) => (
                <li
                  key={obs.id}
                  className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2"
                >
                  <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {obs.channel}
                    {obs.observedAt
                      ? ` · ${new Date(obs.observedAt).toLocaleDateString("en-US")}`
                      : ""}
                  </p>
                  <p className="mt-1 text-sm text-vezzt-950">
                    {obs.observation}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote>No digital observations recorded.</EmptyNote>
          )}
        </Section>

        <Section
          title="Opportunity scores"
          hint="All scores stay null until a methodology is approved."
        >
          {hasScores ? (
            <dl className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
              <Field
                label="Market potential"
                value={formatDecimal(market.marketPotentialScore)}
              />
              <Field
                label="Competition"
                value={formatDecimal(market.competitionScore)}
              />
              <Field
                label="Maps opportunity"
                value={formatDecimal(market.mapsOpportunityScore)}
              />
              <Field
                label="Demographic"
                value={formatDecimal(market.demographicScore)}
              />
              <Field
                label="Demand"
                value={formatDecimal(market.demandScore)}
              />
              <Field
                label="Final opportunity"
                value={formatDecimal(market.finalOpportunityScore)}
              />
            </dl>
          ) : (
            <EmptyNote>Not scored yet.</EmptyNote>
          )}
        </Section>
      </main>
    </div>
  );
}
