"use client";

import { useMemo, useState } from "react";
import type { LocalOpportunityAreaRow } from "@/lib/loa-queries";

function formatInt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US");
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

function formatShare(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

export function LocalOpportunityAreasTable({
  rows,
}: {
  rows: LocalOpportunityAreaRow[];
}) {
  const [stateFilter, setStateFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [search, setSearch] = useState("");

  const states = useMemo(
    () => [...new Set(rows.map((r) => r.state))].sort(),
    [rows],
  );
  const markets = useMemo(
    () =>
      [...new Set(rows.map((r) => r.macroMarketName))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (marketFilter !== "all" && r.macroMarketName !== marketFilter) {
        return false;
      }
      if (q) {
        const hay = `${r.displayName} ${r.macroMarketName} ${r.state}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, stateFilter, marketFilter, search]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-600">
          Local Opportunity Areas use a fixed <strong>15-mile</strong> radius
          with ZCTA-centroid demographics (ACS 2024, growth vs 2019). Competition
          and scores are <strong>Not calculated</strong>.
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
            Macro market
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="ml-2 max-w-xs rounded border border-neutral-300 px-2 py-1 text-sm"
            >
              <option value="all">All</option>
              {markets.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="ml-2 rounded border border-neutral-300 px-2 py-1 text-sm"
              placeholder="Name"
            />
          </label>
          <p className="self-end text-xs text-neutral-500">
            Showing {filtered.length} of {rows.length}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 text-left">Opportunity area</th>
              <th className="px-3 py-2 text-left">State</th>
              <th className="px-3 py-2 text-left">Macro market</th>
              <th className="px-3 py-2 text-left">Center</th>
              <th className="px-3 py-2 text-left">Pop (15mi)</th>
              <th className="px-3 py-2 text-left">Pop growth</th>
              <th className="px-3 py-2 text-left">Owner-occ HH</th>
              <th className="px-3 py-2 text-left">Homeown %</th>
              <th className="px-3 py-2 text-left">Med income</th>
              <th className="px-3 py-2 text-left">SF share</th>
              <th className="px-3 py-2 text-left">ZCTAs</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-neutral-100">
                <td className="px-3 py-2 font-medium text-vezzt-950">
                  {r.displayName}
                </td>
                <td className="px-3 py-2">{r.state}</td>
                <td className="px-3 py-2 text-neutral-700">{r.macroMarketName}</td>
                <td className="px-3 py-2 tabular-nums text-xs text-neutral-600">
                  {r.centerLat.toFixed(4)}, {r.centerLng.toFixed(4)}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatInt(r.population)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPct(r.populationGrowth)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatInt(r.ownerOccupiedUnits)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {r.ownerOccupiedRate == null
                    ? "—"
                    : `${r.ownerOccupiedRate.toFixed(1)}%`}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatMoney(r.medianHouseholdIncome)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatShare(r.singleFamilyShare)}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.zctaCount ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
