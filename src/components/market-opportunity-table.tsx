"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { OpportunityMarketRow } from "@/lib/opportunity-queries";

type SortKey =
  | "marketName"
  | "population"
  | "populationGrowth"
  | "households"
  | "ownerOccupiedUnits"
  | "ownerOccupiedRate"
  | "medianHouseholdIncome"
  | "medianHomeValue"
  | "housingUnits"
  | "housingGrowth"
  | "singleFamilyShare";

function formatInt(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US");
}

function formatPct(n: number | null, digits = 1): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function formatRate(n: number | null): string {
  if (n === null) return "—";
  // owner_occupied_rate is stored as 0-100 from computeOwnerOccupiedRate
  return `${n.toFixed(1)}%`;
}

function formatShare(n: number | null): string {
  if (n === null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatMoney(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function MarketOpportunityTable({
  rows,
}: {
  rows: OpportunityMarketRow[];
}) {
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [minPop, setMinPop] = useState<string>("");
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("population");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const states = useMemo(() => {
    return [
      ...new Set(rows.flatMap((r) => r.states)),
    ].sort((a, b) => a.localeCompare(b));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = minPop.trim() === "" ? null : Number(minPop);
    return rows.filter((r) => {
      if (stateFilter !== "all" && !r.states.includes(stateFilter)) return false;
      if (min !== null && Number.isFinite(min)) {
        if (r.population === null || r.population < min) return false;
      }
      if (q) {
        const hay = `${r.marketName} ${r.states.join(" ")} ${r.geographyName ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, stateFilter, minPop, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc"
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      }
      const an = Number(av);
      const bn = Number(bv);
      return sortDir === "asc" ? an - bn : bn - an;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "marketName" ? "asc" : "desc");
    }
  }

  function SortHeader({
    label,
    column,
  }: {
    label: string;
    column: SortKey;
  }) {
    const active = sortKey === column;
    return (
      <th className="whitespace-nowrap px-3 py-2 text-left">
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 hover:text-vezzt-900"
        >
          {label}
          {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  }

  const datasetYear = rows.find((r) => r.datasetYear)?.datasetYear ?? null;
  const baselineYear =
    rows.find((r) => r.baselineDatasetYear)?.baselineDatasetYear ?? null;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-600">
          Demographic screening only. Competition and Opportunity Score are{" "}
          <span className="font-medium text-neutral-800">Not calculated</span>.
          {datasetYear ? (
            <>
              {" "}
              Census source: ACS 5-Year {datasetYear}
              {baselineYear ? ` (growth vs ${baselineYear})` : ""}.
            </>
          ) : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <label className="text-xs text-neutral-600">
            State
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="ml-2 rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
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
            Min population
            <input
              type="number"
              value={minPop}
              onChange={(e) => setMinPop(e.target.value)}
              placeholder="e.g. 25000"
              className="ml-2 w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-neutral-600">
            Search
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Market name"
              className="ml-2 w-48 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </label>
          <p className="self-end text-xs text-neutral-500">
            Showing {sorted.length} of {rows.length} markets
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50">
            <tr>
              <SortHeader label="Market" column="marketName" />
              <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                State(s)
              </th>
              <SortHeader label="Population" column="population" />
              <SortHeader label="Pop growth" column="populationGrowth" />
              <SortHeader label="Households" column="households" />
              <SortHeader label="Owner-occ HH" column="ownerOccupiedUnits" />
              <SortHeader label="Homeownership %" column="ownerOccupiedRate" />
              <SortHeader label="Med. income" column="medianHouseholdIncome" />
              <SortHeader label="Med. home value" column="medianHomeValue" />
              <SortHeader label="Housing units" column="housingUnits" />
              <SortHeader label="Housing growth" column="housingGrowth" />
              <SortHeader label="SF share" column="singleFamilyShare" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr
                key={r.id}
                className="border-t border-neutral-100 hover:bg-neutral-50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/market-opportunity/${r.marketSlug}`}
                    className="font-medium text-vezzt-900 hover:underline"
                  >
                    {r.marketName}
                  </Link>
                </td>
                <td className="px-3 py-2 text-neutral-700">
                  {r.states.join(", ") || "—"}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatInt(r.population)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPct(r.populationGrowth)}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatInt(r.households)}</td>
                <td className="px-3 py-2 tabular-nums">
                  {formatInt(r.ownerOccupiedUnits)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatRate(r.ownerOccupiedRate)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatMoney(r.medianHouseholdIncome)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatMoney(r.medianHomeValue)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatInt(r.housingUnits)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatPct(r.housingGrowth)}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatShare(r.singleFamilyShare)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-3 py-8 text-center text-sm text-neutral-500"
                >
                  No markets match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
