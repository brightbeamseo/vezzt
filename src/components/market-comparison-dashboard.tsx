"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  COMPANY_SCALES,
  OWNERSHIP_MODELS,
} from "@/lib/companies";
import { MARKETS } from "@/lib/markets";
import {
  getNumericSortValue,
  summarizeMarketComparisonRows,
} from "@/lib/market-comparison-utils";
import {
  DEFAULT_MARKET_COMPARISON_FILTERS,
  DEFAULT_VISIBLE_COLUMNS,
  FUTURE_METRIC_LABEL,
  MARKET_COMPARISON_COLUMNS,
  type MarketComparisonColumnId,
  type MarketComparisonFilters,
  type MarketComparisonPayload,
  type MarketComparisonRow,
} from "@/lib/market-comparison-types";
import type { QualificationStatus } from "@/lib/qualification";

type SortDir = "asc" | "desc";

type Props = {
  payload: MarketComparisonPayload;
};

const QUAL_STATUSES: Array<QualificationStatus | "all"> = [
  "all",
  "qualified",
  "below_threshold",
  "excluded",
  "manual_review",
];

const COMPARE_FIELDS: Array<{
  key: keyof MarketComparisonRow;
  label: string;
  format: (row: MarketComparisonRow) => string;
}> = [
  {
    key: "reviewCount",
    label: "Reviews",
    format: (r) => formatInt(r.reviewCount),
  },
  {
    key: "rating",
    label: "Rating",
    format: (r) => (r.rating == null ? "—" : r.rating.toFixed(1)),
  },
  {
    key: "weeklyReviewVelocity",
    label: "Review velocity",
    format: (r) => formatFloat(r.weeklyReviewVelocity, 2),
  },
  {
    key: "localOrganicTraffic",
    label: "Organic traffic",
    format: (r) => formatInt(r.localOrganicTraffic),
  },
  {
    key: "localOrganicKeywords",
    label: "Organic keywords",
    format: (r) => formatInt(r.localOrganicKeywords),
  },
  {
    key: "localReferringDomains",
    label: "Referring domains",
    format: (r) => formatInt(r.localReferringDomains),
  },
  {
    key: "parentDomainRating",
    label: "Parent DR",
    format: (r) => formatFloat(r.parentDomainRating, 1),
  },
  {
    key: "shareOfLocalVoice",
    label: "SoLV",
    format: (r) => formatPct(r.shareOfLocalVoice),
  },
  {
    key: "averageGridRank",
    label: "AGR",
    format: (r) => formatFloat(r.averageGridRank, 2),
  },
  {
    key: "top3Coverage",
    label: "Top-3 coverage",
    format: (r) => formatPct(r.top3Coverage),
  },
];

function formatInt(n: number | null | undefined): string {
  if (n == null) return "—";
  return Math.round(n).toLocaleString("en-US");
}

function formatFloat(n: number | null | undefined, digits: number): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

function formatPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function formatOrdinal(p: number | null): string | null {
  if (p == null) return null;
  return `${p}th percentile`;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function applyFilters(
  rows: MarketComparisonRow[],
  filters: MarketComparisonFilters,
): MarketComparisonRow[] {
  return rows.filter((row) => {
    if (filters.city !== "all" && row.city !== filters.city) return false;
    if ((row.reviewCount ?? 0) < filters.minReviews) return false;
    if (
      filters.companyScale !== "all" &&
      row.companyScale !== filters.companyScale
    ) {
      return false;
    }
    if (
      filters.ownershipModel !== "all" &&
      row.ownershipModel !== filters.ownershipModel
    ) {
      return false;
    }
    if (
      filters.qualificationStatus !== "all" &&
      row.qualificationStatus !== filters.qualificationStatus
    ) {
      return false;
    }
    if (filters.hasAhrefs && !row.hasAhrefs) return false;
    if (filters.hasGeogrid && !row.hasGeogrid) return false;
    if (filters.hasMultipleReviewSnapshots && !row.hasMultipleReviewSnapshots) {
      return false;
    }
    if (filters.missingDataOnly && row.dataCompleteness >= 100) return false;
    return true;
  });
}

function PercentileCell({
  value,
  percentile,
  display,
  compact,
}: {
  value: number | null;
  percentile: number | null;
  display: string;
  compact: boolean;
}) {
  if (value == null) {
    return <span className="text-neutral-400">—</span>;
  }
  return (
    <div className={compact ? "space-y-0.5" : "space-y-1"}>
      <div className="tabular-nums text-vezzt-950">{display}</div>
      {percentile != null ? (
        <>
          <div
            className="h-1.5 w-full overflow-hidden rounded bg-neutral-100"
            title={formatOrdinal(percentile) ?? undefined}
          >
            <div
              className="h-full rounded bg-vezzt-600/80"
              style={{ width: `${Math.max(4, Math.min(100, percentile))}%` }}
            />
          </div>
          <div className="text-[10px] text-neutral-500">
            {formatOrdinal(percentile)}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function MarketComparisonDashboard({ payload }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<MarketComparisonFilters>({
    ...DEFAULT_MARKET_COMPARISON_FILTERS,
    marketId: payload.marketId,
    sector: payload.sector,
  });
  const [sortKey, setSortKey] = useState<MarketComparisonColumnId>("reviewCount");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visibleOrdered, setVisibleOrdered] = useState<MarketComparisonColumnId[]>(
    DEFAULT_VISIBLE_COLUMNS,
  );
  const [columnPanelOpen, setColumnPanelOpen] = useState(false);
  const [compact, setCompact] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);

  function navigateCohort(marketId: string, sector: string) {
    setFilters((f) => ({ ...f, marketId, sector }));
    const qs = new URLSearchParams({ market: marketId, sector });
    router.push(`/admin/market-comparison?${qs.toString()}`);
  }

  const filtered = useMemo(
    () => applyFilters(payload.rows, filters),
    [payload.rows, filters],
  );

  const sorted = useMemo(() => {
    const col = MARKET_COMPARISON_COLUMNS.find((c) => c.id === sortKey);
    const copy = [...filtered];
    copy.sort((a, b) => {
      if (col?.numeric) {
        const av = getNumericSortValue(a, sortKey);
        const bv = getNumericSortValue(b, sortKey);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        // Lower AGR is better — still sort by raw number; user picks dir.
        const cmp = av - bv;
        return sortDir === "asc" ? cmp : -cmp;
      }
      const as = String(cellText(a, sortKey) ?? "");
      const bs = String(cellText(b, sortKey) ?? "");
      const cmp = as.localeCompare(bs);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const summary = useMemo(
    () => summarizeMarketComparisonRows(sorted),
    [sorted],
  );

  const selectedRows = sorted.filter((r) => selected.has(r.businessId));

  function toggleSort(id: MarketComparisonColumnId) {
    if (sortKey === id) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(id);
      setSortDir("desc");
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 5) return prev;
        next.add(id);
      }
      return next;
    });
  }

  function toggleColumn(id: MarketComparisonColumnId) {
    setVisibleOrdered((prev) => {
      if (prev.includes(id)) return prev.filter((c) => c !== id);
      const order = MARKET_COMPARISON_COLUMNS.map((c) => c.id);
      return [...prev, id].sort(
        (a, b) => order.indexOf(a) - order.indexOf(b),
      );
    });
  }

  function moveColumn(id: MarketComparisonColumnId, dir: -1 | 1) {
    setVisibleOrdered((prev) => {
      const idx = prev.indexOf(id);
      if (idx < 0) return prev;
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      next.splice(target, 0, item!);
      return next;
    });
  }

  function exportCsv() {
    const cols = visibleOrdered
      .map((id) => MARKET_COMPARISON_COLUMNS.find((c) => c.id === id)!)
      .filter(Boolean);

    const headers = cols.flatMap((c) => {
      if (c.percentileOf) {
        return [c.label, `${c.label} percentile`];
      }
      return [c.label];
    });

    const lines = [
      headers.map(csvEscape).join(","),
      ...sorted.map((row) =>
        cols
          .flatMap((c) => {
            const raw = cellExport(row, c.id);
            if (c.percentileOf) {
              const p = row.percentiles[c.percentileOf];
              return [raw, p == null ? "" : String(p)];
            }
            return [raw];
          })
          .map(csvEscape)
          .join(","),
      ),
    ];

    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vezzt-market-comparison-${filters.marketId}-${filters.sector}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cellPad = compact ? "px-2 py-1.5" : "px-3 py-2.5";

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[
          { label: "In view", value: String(summary.businessCount) },
          { label: "With Ahrefs", value: String(summary.withAhrefs) },
          { label: "With GeoGrid", value: String(summary.withGeogrid) },
          {
            label: "2+ review snaps",
            value: String(summary.withMultipleReviewSnapshots),
          },
          { label: "Median reviews", value: formatInt(summary.medianReviews) },
          {
            label: "Median traffic",
            value: formatInt(summary.medianOrganicTraffic),
          },
          { label: "Median SoLV", value: formatPct(summary.medianSolv) },
          {
            label: "Avg completeness",
            value:
              summary.averageDataCompleteness == null
                ? "—"
                : `${summary.averageDataCompleteness}%`,
          },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2"
          >
            <p className="text-[10px] uppercase tracking-wide text-neutral-500">
              {s.label}
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-vezzt-950">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-neutral-200 bg-white p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-neutral-600">
            Market
            <select
              className="mt-1 block rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              value={filters.marketId}
              onChange={(e) => navigateCohort(e.target.value, filters.sector)}
            >
              {Object.values(MARKETS).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Sector
            <select
              className="mt-1 block rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              value={filters.sector}
              onChange={(e) => navigateCohort(filters.marketId, e.target.value)}
            >
              <option value="roofing">Roofing</option>
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            City
            <select
              className="mt-1 block rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              value={filters.city}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  city: e.target.value as MarketComparisonFilters["city"],
                }))
              }
            >
              <option value="all">All</option>
              {payload.cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Min reviews
            <input
              type="number"
              min={0}
              className="mt-1 block w-24 rounded border border-neutral-300 px-2 py-1.5 text-sm"
              value={filters.minReviews}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  minReviews: Number(e.target.value) || 0,
                }))
              }
            />
          </label>
          <label className="text-xs text-neutral-600">
            Company scale
            <select
              className="mt-1 block rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              value={filters.companyScale}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  companyScale: e.target
                    .value as MarketComparisonFilters["companyScale"],
                }))
              }
            >
              <option value="all">All</option>
              {COMPANY_SCALES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Ownership
            <select
              className="mt-1 block rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              value={filters.ownershipModel}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  ownershipModel: e.target
                    .value as MarketComparisonFilters["ownershipModel"],
                }))
              }
            >
              <option value="all">All</option>
              {OWNERSHIP_MODELS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-neutral-600">
            Qualification
            <select
              className="mt-1 block rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm"
              value={filters.qualificationStatus}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  qualificationStatus: e.target
                    .value as MarketComparisonFilters["qualificationStatus"],
                }))
              }
            >
              {QUAL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-neutral-700">
          {(
            [
              ["hasAhrefs", "Has Ahrefs data"],
              ["hasGeogrid", "Has GeoGrid data"],
              ["hasMultipleReviewSnapshots", "Has multiple review snapshots"],
              ["missingDataOnly", "Missing data only"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filters[key]}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, [key]: e.target.checked }))
                }
              />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          Percentiles are relative to the loaded market + sector cohort (
          {payload.rows.length} businesses), not the narrower table filter.
        </p>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setColumnPanelOpen((o) => !o)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
        >
          Columns
        </button>
        <button
          type="button"
          onClick={() => setCompact((c) => !c)}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
        >
          {compact ? "Expanded" : "Compact"} mode
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
        >
          Export CSV
        </button>
        <button
          type="button"
          disabled={selected.size < 2 || selected.size > 5}
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg bg-vezzt-950 px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Compare ({selected.size}/2–5)
        </button>
        {selected.size > 0 ? (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-xs text-neutral-500 underline"
          >
            Clear selection
          </button>
        ) : null}
        <span className="ml-auto text-xs text-neutral-500">
          Showing {sorted.length} of {payload.rows.length}
        </span>
      </div>

      {columnPanelOpen ? (
        <div className="rounded-lg border border-neutral-200 bg-white p-3">
          <p className="mb-2 text-xs font-medium text-neutral-700">
            Show / hide / reorder visible columns
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {MARKET_COMPARISON_COLUMNS.map((col) => {
              const on = visibleOrdered.includes(col.id);
              const idx = visibleOrdered.indexOf(col.id);
              return (
                <div
                  key={col.id}
                  className="flex items-center gap-2 rounded border border-neutral-100 px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleColumn(col.id)}
                  />
                  <span className="flex-1">
                    <span className="text-neutral-400">{col.group} · </span>
                    {col.label}
                  </span>
                  {on ? (
                    <span className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border px-1 disabled:opacity-30"
                        disabled={idx <= 0}
                        onClick={() => moveColumn(col.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="rounded border px-1 disabled:opacity-30"
                        disabled={idx >= visibleOrdered.length - 1}
                        onClick={() => moveColumn(col.id, 1)}
                      >
                        ↓
                      </button>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
        <table className="min-w-full text-left">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
            <tr>
              <th className={`${cellPad} w-8`} />
              {visibleOrdered.map((id) => {
                const col = MARKET_COMPARISON_COLUMNS.find((c) => c.id === id)!;
                return (
                  <th key={id} className={`${cellPad} font-medium`}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-vezzt-800"
                      onClick={() => toggleSort(id)}
                    >
                      {col.label}
                      {sortKey === id ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.businessId}
                className="border-t border-neutral-100 hover:bg-neutral-50/80"
              >
                <td className={cellPad}>
                  <input
                    type="checkbox"
                    checked={selected.has(row.businessId)}
                    onChange={() => toggleSelect(row.businessId)}
                    aria-label={`Select ${row.businessName}`}
                  />
                </td>
                {visibleOrdered.map((id) => (
                  <td
                    key={id}
                    className={`${cellPad} text-sm ${
                      compact ? "align-middle" : "align-top"
                    }`}
                  >
                    {renderCell(row, id, compact)}
                  </td>
                ))}
              </tr>
            ))}
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleOrdered.length + 1}
                  className="px-3 py-8 text-center text-sm text-neutral-500"
                >
                  No businesses match the current filters.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Comparison drawer */}
      {drawerOpen && selectedRows.length >= 2 ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <button
            type="button"
            className="flex-1 cursor-default"
            aria-label="Close comparison"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="h-full w-full max-w-3xl overflow-y-auto bg-white shadow-xl">
            <div className="sticky top-0 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-neutral-500">
                  Side-by-side
                </p>
                <h2 className="text-base font-semibold text-vezzt-950">
                  Compare {selectedRows.length} businesses
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded border border-neutral-300 px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>
            <div className="overflow-x-auto p-4">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                    <th className="py-2 pr-3 font-medium">Metric</th>
                    {selectedRows.map((r) => (
                      <th key={r.businessId} className="px-2 py-2 font-medium">
                        <Link
                          href={`/businesses/${r.businessId}`}
                          className="text-vezzt-700 hover:underline"
                        >
                          {r.businessName}
                        </Link>
                        <div className="font-normal text-neutral-400">
                          {r.city ?? "—"}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_FIELDS.map((field) => (
                    <tr
                      key={field.label}
                      className="border-t border-neutral-100"
                    >
                      <td className="py-2 pr-3 text-xs text-neutral-500">
                        {field.label}
                      </td>
                      {selectedRows.map((r) => (
                        <td
                          key={r.businessId}
                          className="px-2 py-2 tabular-nums text-vezzt-950"
                        >
                          {field.format(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function cellText(row: MarketComparisonRow, id: MarketComparisonColumnId): string {
  return cellExport(row, id);
}

function cellExport(row: MarketComparisonRow, id: MarketComparisonColumnId): string {
  switch (id) {
    case "businessName":
      return row.businessName;
    case "city":
      return row.city ?? "";
    case "companyName":
      return row.companyName ?? "";
    case "companyScale":
      return row.companyScale ?? "";
    case "ownershipModel":
      return row.ownershipModel ?? "";
    case "website":
      return row.websiteUrl ?? "";
    case "analysisTarget":
      return row.analysisTarget ?? "";
    case "analysisMode":
      return row.analysisMode ?? "";
    case "reviewCount":
      return row.reviewCount == null ? "" : String(row.reviewCount);
    case "rating":
      return row.rating == null ? "" : String(row.rating);
    case "reviewSnapshotDate":
      return row.reviewSnapshotDate ?? "";
    case "reviewsGainedSincePrior":
      return row.reviewsGainedSincePrior == null
        ? ""
        : String(row.reviewsGainedSincePrior);
    case "weeklyReviewVelocity":
      return row.weeklyReviewVelocity == null
        ? ""
        : String(row.weeklyReviewVelocity);
    case "estimatedMonthlyReviewVelocity":
      return row.estimatedMonthlyReviewVelocity == null
        ? ""
        : String(row.estimatedMonthlyReviewVelocity);
    case "localOrganicTraffic":
      return row.localOrganicTraffic == null
        ? ""
        : String(row.localOrganicTraffic);
    case "localOrganicKeywords":
      return row.localOrganicKeywords == null
        ? ""
        : String(row.localOrganicKeywords);
    case "localKeywordsTop3":
      return row.localKeywordsTop3 == null ? "" : String(row.localKeywordsTop3);
    case "localReferringDomains":
      return row.localReferringDomains == null
        ? ""
        : String(row.localReferringDomains);
    case "localBacklinks":
      return row.localBacklinks == null ? "" : String(row.localBacklinks);
    case "localTrafficValue":
      return row.localTrafficValue == null ? "" : String(row.localTrafficValue);
    case "parentDomainRating":
      return row.parentDomainRating == null
        ? ""
        : String(row.parentDomainRating);
    case "parentOrganicTraffic":
      return row.parentOrganicTraffic == null
        ? ""
        : String(row.parentOrganicTraffic);
    case "parentOrganicKeywords":
      return row.parentOrganicKeywords == null
        ? ""
        : String(row.parentOrganicKeywords);
    case "parentReferringDomains":
      return row.parentReferringDomains == null
        ? ""
        : String(row.parentReferringDomains);
    case "shareOfLocalVoice":
      return row.shareOfLocalVoice == null ? "" : String(row.shareOfLocalVoice);
    case "averageGridRank":
      return row.averageGridRank == null ? "" : String(row.averageGridRank);
    case "averageTotalGridRank":
      return row.averageTotalGridRank == null
        ? ""
        : String(row.averageTotalGridRank);
    case "top3Coverage":
      return row.top3Coverage == null ? "" : String(row.top3Coverage);
    case "top10Coverage":
      return row.top10Coverage == null ? "" : String(row.top10Coverage);
    case "geogridScanDate":
      return row.geogridScanDate ?? "";
    case "dataCompleteness":
      return String(row.dataCompleteness);
    case "missingFields":
      return row.missingFields.join("; ");
    case "latestDataRefresh":
      return row.latestDataRefresh ?? "";
    case "manualReviewFlag":
      return row.classificationIsManual ? "yes" : "no";
    case "businessStrength":
    case "growthScore":
    case "marketStrength":
    case "vestimate":
    case "confidenceScore":
      return FUTURE_METRIC_LABEL;
    default:
      return "";
  }
}

function renderCell(
  row: MarketComparisonRow,
  id: MarketComparisonColumnId,
  compact: boolean,
) {
  switch (id) {
    case "businessName":
      return (
        <div>
          <Link
            href={`/businesses/${row.businessId}`}
            className="font-medium text-vezzt-700 underline-offset-2 hover:underline"
          >
            {row.businessName}
          </Link>
          <div
            className={`flex flex-wrap gap-2 text-[10px] ${
              compact ? "mt-0.5" : "mt-1"
            }`}
          >
            {row.websiteUrl ? (
              <a
                href={row.websiteUrl}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-500 hover:underline"
              >
                Website
              </a>
            ) : null}
            {row.googleMapsUrl ? (
              <a
                href={row.googleMapsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-500 hover:underline"
              >
                Maps
              </a>
            ) : null}
            {row.ahrefsUrl ? (
              <a
                href={row.ahrefsUrl}
                target="_blank"
                rel="noreferrer"
                className="text-neutral-500 hover:underline"
              >
                Ahrefs
              </a>
            ) : null}
            {row.hasGeogrid ? (
              <Link
                href={row.geogridUrl ?? `/businesses/${row.businessId}`}
                className="text-neutral-500 hover:underline"
              >
                GeoGrid
              </Link>
            ) : null}
          </div>
        </div>
      );
    case "city":
      return <span>{row.city ?? "—"}</span>;
    case "companyName":
      return <span>{row.companyName ?? "—"}</span>;
    case "companyScale":
      return <span className="text-xs">{row.companyScale ?? "—"}</span>;
    case "ownershipModel":
      return <span className="text-xs">{row.ownershipModel ?? "—"}</span>;
    case "website":
      return row.websiteUrl ? (
        <a
          href={row.websiteUrl}
          target="_blank"
          rel="noreferrer"
          className="text-vezzt-700 hover:underline"
        >
          Link
        </a>
      ) : (
        <span className="text-neutral-400">—</span>
      );
    case "analysisTarget":
      return (
        <span className="max-w-[12rem] truncate text-xs" title={row.analysisTarget ?? ""}>
          {row.analysisTarget ?? "—"}
        </span>
      );
    case "analysisMode":
      return <span className="text-xs">{row.analysisMode ?? "—"}</span>;
    case "reviewCount":
      return (
        <PercentileCell
          value={row.reviewCount}
          percentile={row.percentiles.reviewCount}
          display={formatInt(row.reviewCount)}
          compact={compact}
        />
      );
    case "rating":
      return (
        <span className="tabular-nums">
          {row.rating == null ? "—" : row.rating.toFixed(1)}
        </span>
      );
    case "reviewSnapshotDate":
      return <span className="text-xs">{row.reviewSnapshotDate ?? "—"}</span>;
    case "reviewsGainedSincePrior":
      return (
        <span className="tabular-nums">
          {formatInt(row.reviewsGainedSincePrior)}
        </span>
      );
    case "weeklyReviewVelocity":
      return (
        <span className="tabular-nums">
          {formatFloat(row.weeklyReviewVelocity, 2)}
        </span>
      );
    case "estimatedMonthlyReviewVelocity":
      return (
        <span className="tabular-nums">
          {formatFloat(row.estimatedMonthlyReviewVelocity, 2)}
        </span>
      );
    case "localOrganicTraffic":
      return (
        <PercentileCell
          value={row.localOrganicTraffic}
          percentile={row.percentiles.localOrganicTraffic}
          display={
            formatInt(row.localOrganicTraffic) +
            (row.localAhrefsFromParent ? " *" : "")
          }
          compact={compact}
        />
      );
    case "localOrganicKeywords":
      return (
        <span className="tabular-nums">
          {formatInt(row.localOrganicKeywords)}
        </span>
      );
    case "localKeywordsTop3":
      return (
        <span className="tabular-nums">{formatInt(row.localKeywordsTop3)}</span>
      );
    case "localReferringDomains":
      return (
        <PercentileCell
          value={row.localReferringDomains}
          percentile={row.percentiles.localReferringDomains}
          display={formatInt(row.localReferringDomains)}
          compact={compact}
        />
      );
    case "localBacklinks":
      return (
        <span className="tabular-nums">{formatInt(row.localBacklinks)}</span>
      );
    case "localTrafficValue":
      return (
        <span className="tabular-nums">{formatInt(row.localTrafficValue)}</span>
      );
    case "parentDomainRating":
      return (
        <span className="tabular-nums">
          {formatFloat(row.parentDomainRating, 1)}
        </span>
      );
    case "parentOrganicTraffic":
      return (
        <span className="tabular-nums">
          {formatInt(row.parentOrganicTraffic)}
        </span>
      );
    case "parentOrganicKeywords":
      return (
        <span className="tabular-nums">
          {formatInt(row.parentOrganicKeywords)}
        </span>
      );
    case "parentReferringDomains":
      return (
        <span className="tabular-nums">
          {formatInt(row.parentReferringDomains)}
        </span>
      );
    case "shareOfLocalVoice":
      return (
        <PercentileCell
          value={row.shareOfLocalVoice}
          percentile={row.percentiles.shareOfLocalVoice}
          display={formatPct(row.shareOfLocalVoice)}
          compact={compact}
        />
      );
    case "averageGridRank":
      return (
        <span className="tabular-nums">
          {formatFloat(row.averageGridRank, 2)}
        </span>
      );
    case "averageTotalGridRank":
      return (
        <span className="tabular-nums">
          {formatFloat(row.averageTotalGridRank, 2)}
        </span>
      );
    case "top3Coverage":
      return (
        <span className="tabular-nums">
          {row.top3Coverage == null
            ? "—"
            : `${row.foundInTop3Count}/${row.totalGridPoints} (${formatPct(row.top3Coverage)})`}
        </span>
      );
    case "top10Coverage":
      return (
        <span className="tabular-nums">
          {row.top10Coverage == null
            ? "—"
            : `${row.foundInTop10Count}/${row.totalGridPoints} (${formatPct(row.top10Coverage)})`}
        </span>
      );
    case "geogridScanDate":
      return (
        <span className="text-xs">
          {row.geogridScanDate
            ? new Date(row.geogridScanDate).toLocaleDateString("en-US")
            : "—"}
        </span>
      );
    case "dataCompleteness":
      return (
        <div>
          <span className="font-medium tabular-nums">
            {row.dataCompleteness}%
          </span>
          {!compact && row.missingFields.length > 0 ? (
            <div className="mt-0.5 max-w-[10rem] truncate text-[10px] text-amber-700">
              {row.missingFields.join(", ")}
            </div>
          ) : null}
        </div>
      );
    case "missingFields":
      return (
        <span className="text-[11px] text-amber-800">
          {row.missingFields.length ? row.missingFields.join(", ") : "—"}
        </span>
      );
    case "latestDataRefresh":
      return (
        <span className="text-xs">
          {row.latestDataRefresh
            ? new Date(row.latestDataRefresh).toLocaleDateString("en-US")
            : "—"}
        </span>
      );
    case "manualReviewFlag":
      return row.classificationIsManual ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900">
          Manual
        </span>
      ) : (
        <span className="text-neutral-400">—</span>
      );
    case "businessStrength":
    case "growthScore":
    case "marketStrength":
    case "vestimate":
    case "confidenceScore":
      return (
        <span className="text-neutral-400 italic">{FUTURE_METRIC_LABEL}</span>
      );
    default:
      return null;
  }
}
