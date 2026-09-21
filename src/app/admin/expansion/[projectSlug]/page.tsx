import Link from "next/link";
import { notFound } from "next/navigation";
import { ExpansionMarketsTable } from "@/components/expansion/expansion-markets-table";
import { ExpansionSummaryCards } from "@/components/expansion/expansion-summary-cards";
import {
  getExpansionMarketList,
  summarizeExpansionMarkets,
} from "@/lib/expansion-queries";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ projectSlug: string }>;
};

export default async function ExpansionProjectPage({ params }: PageProps) {
  const { projectSlug } = await params;

  let project;
  let markets;
  try {
    const result = await getExpansionMarketList(projectSlug);
    project = result.project;
    markets = result.markets;
  } catch {
    notFound();
  }

  const summary = summarizeExpansionMarkets(markets);

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Internal · Expansion research
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              {project.name}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-vezzt-200">
              {project.regionLabel} · {project.industry.replace(/_/g, " ")} ·
              Phase A shells only. Metrics stay empty until real collection.
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
          >
            Map
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] space-y-6 px-4 py-6 sm:px-6">
        <ExpansionSummaryCards
          candidateMarkets={summary.candidateMarkets}
          totalOwnerHouseholds={summary.totalOwnerHouseholds}
          dedicatedGutterCompetitors={summary.dedicatedGutterCompetitors}
          averageHhPerCompetitor={summary.averageHhPerCompetitor}
        />
        <ExpansionMarketsTable projectSlug={project.slug} rows={markets} />
      </main>
    </div>
  );
}
