import type { ReactNode } from "react";

export function ExpansionSummaryCards({
  candidateMarkets,
  totalOwnerHouseholds,
  dedicatedGutterCompetitors,
  averageHhPerCompetitor,
}: {
  candidateMarkets: number;
  totalOwnerHouseholds: number | null;
  dedicatedGutterCompetitors: number | null;
  averageHhPerCompetitor: number | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card
        label="Candidate markets"
        value={candidateMarkets.toLocaleString("en-US")}
        hint="Seeded research shells"
      />
      <Card
        label="Owner-occupied HH (sum)"
        value={formatOrDash(totalOwnerHouseholds)}
        hint="Only markets with real data"
      />
      <Card
        label="Dedicated gutter competitors"
        value={formatOrDash(dedicatedGutterCompetitors)}
        hint="Sum of dedicated counts"
      />
      <Card
        label="Avg owner HH / dedicated"
        value={
          averageHhPerCompetitor == null
            ? "-"
            : averageHhPerCompetitor.toLocaleString("en-US", {
                maximumFractionDigits: 0,
              })
        }
        hint="Across markets with ratios"
      />
    </div>
  );
}

function formatOrDash(n: number | null): string {
  if (n === null) return "-";
  return n.toLocaleString("en-US");
}

function Card({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-vezzt-950">
        {value}
      </p>
      <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
    </div>
  );
}
