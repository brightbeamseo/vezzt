"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ExpansionMarketListRow } from "@/lib/expansion-queries";

type SortKey =
  | "displayName"
  | "status"
  | "ownerOccupiedHouseholds"
  | "singleFamilyDetachedHomes"
  | "medianHouseholdIncome"
  | "medianHomeValue"
  | "housingGrowth"
  | "dedicatedCount"
  | "reviews100Plus"
  | "reviews250Plus"
  | "reviews500Plus"
  | "ownerHhPerDedicated"
  | "top5AvgReviews"
  | "finalOpportunityScore";

function formatInt(n: number | null): string {
  if (n === null) return "-";
  return n.toLocaleString("en-US");
}

function formatPct(n: number | null): string {
  if (n === null) return "-";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
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

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function ExpansionMarketsTable({
  projectSlug,
  rows,
}: {
  projectSlug: string;
  rows: ExpansionMarketListRow[];
}) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("displayName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const hay = `${r.displayName} ${r.state} ${r.status} ${r.slug}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, search]);

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
      setSortDir(
        key === "displayName" || key === "status" ? "asc" : "desc",
      );
    }
  }

  function SortHeader({
    label,
    column,
    align = "left",
  }: {
    label: string;
    column: SortKey;
    align?: "left" | "right";
  }) {
    const active = sortKey === column;
    return (
      <th
        className={`whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-600 ${
          align === "right" ? "text-right" : "text-left"
        }`}
      >
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className="inline-flex items-center gap-1 hover:text-vezzt-950"
        >
          {label}
          <span className="text-[10px] text-neutral-400">
            {active ? (sortDir === "asc" ? "▲" : "▼") : "◇"}
          </span>
        </button>
      </th>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3">
        <p className="text-sm text-neutral-600">
          {sorted.length} of {rows.length} markets
        </p>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter markets..."
          className="w-full max-w-xs rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-vezzt-950 outline-none focus:border-vezzt-600"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <SortHeader label="Market" column="displayName" />
              <SortHeader label="Status" column="status" />
              <SortHeader
                label="Owner HH"
                column="ownerOccupiedHouseholds"
                align="right"
              />
              <SortHeader
                label="SF Detached"
                column="singleFamilyDetachedHomes"
                align="right"
              />
              <SortHeader
                label="Med. Income"
                column="medianHouseholdIncome"
                align="right"
              />
              <SortHeader
                label="Med. Home Value"
                column="medianHomeValue"
                align="right"
              />
              <SortHeader
                label="Housing Growth"
                column="housingGrowth"
                align="right"
              />
              <SortHeader
                label="Dedicated"
                column="dedicatedCount"
                align="right"
              />
              <SortHeader
                label="100+ Reviews"
                column="reviews100Plus"
                align="right"
              />
              <SortHeader
                label="250+ Reviews"
                column="reviews250Plus"
                align="right"
              />
              <SortHeader
                label="500+ Reviews"
                column="reviews500Plus"
                align="right"
              />
              <SortHeader
                label="Owner HH / Dedicated"
                column="ownerHhPerDedicated"
                align="right"
              />
              <SortHeader
                label="Top 5 Avg Reviews"
                column="top5AvgReviews"
                align="right"
              />
              <SortHeader
                label="Opportunity"
                column="finalOpportunityScore"
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.id}
                className="border-t border-neutral-100 hover:bg-neutral-50"
              >
                <td className="px-3 py-2 font-medium text-vezzt-950">
                  <Link
                    href={`/admin/expansion/${projectSlug}/${row.slug}`}
                    className="hover:underline"
                  >
                    {row.displayName}
                  </Link>
                  <span className="ml-1 text-xs font-normal text-neutral-400">
                    {row.state}
                  </span>
                </td>
                <td className="px-3 py-2 capitalize text-neutral-700">
                  {statusLabel(row.status)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatInt(row.ownerOccupiedHouseholds)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatInt(row.singleFamilyDetachedHomes)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(row.medianHouseholdIncome)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatMoney(row.medianHomeValue)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatPct(row.housingGrowth)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatInt(row.dedicatedCount)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatInt(row.reviews100Plus)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatInt(row.reviews250Plus)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatInt(row.reviews500Plus)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatDecimal(row.ownerHhPerDedicated, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatDecimal(row.top5AvgReviews, 0)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {formatDecimal(row.finalOpportunityScore, 1)}
                </td>
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={14}
                  className="px-3 py-8 text-center text-sm text-neutral-500"
                >
                  No markets match this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
