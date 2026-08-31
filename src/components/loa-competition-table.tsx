"use client";

import { Fragment, useMemo, useState } from "react";
import type { LoaCompetitionRow } from "@/lib/loa-competition-queries";

function formatInt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US");
}

function formatNum(n: number | null, digits = 1): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatPct(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

type TopCompetitor = {
  rank?: number;
  title?: string;
  reviews?: number | null;
  rating?: number | null;
  distanceMiles?: number | null;
};

export function LoaCompetitionTable({ rows }: { rows: LoaCompetitionRow[] }) {
  const [stateFilter, setStateFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [qualityFilter, setQualityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const states = useMemo(
    () => [...new Set(rows.map((r) => r.state))].sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (statusFilter !== "all" && r.gbpDiscoveryStatus !== statusFilter) {
        return false;
      }
      if (qualityFilter !== "all" && r.demoQualityFlag !== qualityFilter) {
        return false;
      }
      if (q) {
        const hay = `${r.displayName} ${r.macroMarketName} ${r.state}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, stateFilter, statusFilter, qualityFilter, search]);

  const complete = rows.filter((r) => r.gbpDiscoveryStatus === "complete").length;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-600">
          Phase IIIB roofing GBP discovery. Physical competition = primary
          Roofing contractor ≤15mi. No Opportunity Score yet. Discovery status:{" "}
          <strong>
            {complete}/{rows.length} LOAs complete
          </strong>
          .
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-xs text-neutral-600">
            State
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="all">All</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Discovery
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="all">All</option>
              <option value="complete">complete</option>
              <option value="partial">partial</option>
              <option value="pending">pending</option>
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Demo quality
            <select
              value={qualityFilter}
              onChange={(e) => setQualityFilter(e.target.value)}
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="all">All</option>
              <option value="ok">ok</option>
              <option value="review">review</option>
              <option value="incomplete">incomplete</option>
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="LOA or market"
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-[1600px] w-full border-collapse text-left text-xs">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2">LOA</th>
              <th className="px-3 py-2">State</th>
              <th className="px-3 py-2">Demo</th>
              <th className="px-3 py-2">GBP</th>
              <th className="px-3 py-2 text-right">Pop</th>
              <th className="px-3 py-2 text-right">Pop Δ</th>
              <th className="px-3 py-2 text-right">Owner HH</th>
              <th className="px-3 py-2 text-right">MHI</th>
              <th className="px-3 py-2 text-right">Primary ≤15mi</th>
              <th className="px-3 py-2 text-right">/100k</th>
              <th className="px-3 py-2 text-right">Med rev</th>
              <th className="px-3 py-2 text-right">100+</th>
              <th className="px-3 py-2 text-right">500+</th>
              <th className="px-3 py-2 text-right">OwnerHH/roofer</th>
              <th className="px-3 py-2 text-right">OwnerHH/100+</th>
              <th className="px-3 py-2">Top10</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const top10 = Array.isArray(r.top10Competitors)
                ? (r.top10Competitors as TopCompetitor[])
                : [];
              const open = expanded === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    className="border-t border-neutral-100 hover:bg-neutral-50"
                  >
                    <td className="px-3 py-2 font-medium text-neutral-900">
                      <div>{r.displayName}</div>
                      <div className="text-[10px] font-normal text-neutral-400">
                        {r.macroMarketName}
                      </div>
                    </td>
                    <td className="px-3 py-2">{r.state}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          r.demoQualityFlag === "incomplete"
                            ? "text-red-700"
                            : r.demoQualityFlag === "review"
                              ? "text-amber-700"
                              : "text-neutral-600"
                        }
                        title={r.demoQualityNotes ?? undefined}
                      >
                        {r.demoQualityFlag ?? "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.gbpDiscoveryStatus ?? "—"}</td>
                    <td className="px-3 py-2 text-right">
                      {formatInt(r.population)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatPct(r.populationGrowth)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatInt(r.ownerOccupiedUnits)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatMoney(r.medianHouseholdIncome)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">
                      {formatInt(r.primaryInRadius)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatNum(r.roofersPer100kPop, 1)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatNum(r.reviewsMedian, 0)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatInt(r.reviews100Plus)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatInt(r.reviews500Plus)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatNum(r.ownerHhPerRoofer, 0)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {formatNum(r.ownerHhPer100Plus, 0)}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => setExpanded(open ? null : r.id)}
                        className="text-vezzt-800 underline"
                      >
                        {open ? "Hide" : "Show"}
                      </button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="bg-neutral-50">
                      <td colSpan={16} className="px-3 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                          Top 10 primary roofers by reviews (≤15mi)
                        </div>
                        <ol className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {top10.map((t, i) => (
                            <li
                              key={`${r.id}-${t.rank ?? i}`}
                              className="text-xs text-neutral-700"
                            >
                              {(t.rank ?? i + 1)}. {t.title ?? "—"} ·{" "}
                              {formatInt(t.reviews ?? null)} reviews
                              {t.distanceMiles != null
                                ? ` · ${t.distanceMiles.toFixed(1)}mi`
                                : ""}
                            </li>
                          ))}
                          {!top10.length ? (
                            <li className="text-xs text-neutral-500">
                              No competitors yet (discovery pending or none found)
                            </li>
                          ) : null}
                        </ol>
                        {r.demoQualityNotes ? (
                          <p className="mt-2 text-xs text-amber-800">
                            Demo note: {r.demoQualityNotes}
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
