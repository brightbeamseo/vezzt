"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import type { DashboardBusiness, DashboardSummary } from "@/lib/dashboard-types";
import type { QualificationStatus } from "@/lib/qualification";
import { formatNullable } from "@/lib/format";
import { DashboardSummaryCards } from "@/components/dashboard/summary-cards";
import { DashboardMapWrapper } from "@/components/dashboard/dashboard-map-wrapper";

type SortKey =
  | "name"
  | "reviewCount"
  | "averageRating"
  | "growthScore"
  | "vestimateMid";

type Props = {
  businesses: DashboardBusiness[];
  summary: DashboardSummary;
};

const STATUS_STYLES: Record<QualificationStatus, string> = {
  qualified: "bg-emerald-100 text-emerald-800",
  below_threshold: "bg-amber-100 text-amber-900",
  excluded: "bg-neutral-200 text-neutral-700",
  manual_review: "bg-sky-100 text-sky-900",
};

export function DashboardShell({ businesses, summary }: Props) {
  const [search, setSearch] = useState("");
  const [city, setCity] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState<"all" | QualificationStatus>("all");
  const [minReviews, setMinReviews] = useState("100");
  const [minRating, setMinRating] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("reviewCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cities = useMemo(
    () =>
      [...new Set(businesses.map((b) => b.city).filter(Boolean) as string[])].sort(),
    [businesses],
  );
  const categories = useMemo(
    () =>
      [
        ...new Set(
          businesses.map((b) => b.primaryCategory).filter(Boolean) as string[],
        ),
      ].sort(),
    [businesses],
  );

  const filtered = useMemo(() => {
    const minR = minReviews === "" ? null : Number(minReviews);
    const minRat = minRating === "" ? null : Number(minRating);

    const rows = businesses.filter((b) => {
      const q = search.trim().toLowerCase();
      if (
        q &&
        !b.name.toLowerCase().includes(q) &&
        !(b.city ?? "").toLowerCase().includes(q) &&
        !(b.primaryCategory ?? "").toLowerCase().includes(q)
      ) {
        return false;
      }
      if (city !== "all" && b.city !== city) return false;
      if (category !== "all" && b.primaryCategory !== category) return false;
      if (status !== "all" && b.qualificationStatus !== status) return false;
      if (minR !== null && Number.isFinite(minR)) {
        if ((b.reviewCount ?? -1) < minR) return false;
      }
      if (minRat !== null && Number.isFinite(minRat)) {
        if ((b.averageRating ?? -1) < minRat) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === "name") {
        return a.name.localeCompare(b.name) * dir;
      }
      const an = av === null || av === undefined ? Number.NEGATIVE_INFINITY : Number(av);
      const bn = bv === null || bv === undefined ? Number.NEGATIVE_INFINITY : Number(bv);
      if (an === bn) return a.name.localeCompare(b.name);
      return (an - bn) * dir;
    });

    return rows;
  }, [
    businesses,
    search,
    city,
    category,
    status,
    minReviews,
    minRating,
    sortKey,
    sortDir,
  ]);

  const missingOnMap = filtered.filter((b) => !b.hasCoordinates);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-3 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Internal workspace
            </p>
            <h1 className="text-lg font-semibold tracking-tight">
              Vezzt data dashboard
            </h1>
            <p className="text-xs text-vezzt-200">
              Inspect imported businesses and experiment with scoring inputs.
              Scores are not invented.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Map listings
            </Link>
            <Link
              href="/dashboard/boise-roofing"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Boise Roofing
            </Link>
            <Link
              href="/admin/market-comparison"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Market compare
            </Link>
            <Link
              href="/admin/qualification"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Qualification
            </Link>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6">
        <DashboardSummaryCards summary={summary} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className="h-[420px] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm lg:col-span-2 lg:h-[560px]">
            <DashboardMapWrapper
              businesses={filtered}
              selectedId={selectedId}
              onSelect={(b) => setSelectedId(b.id)}
            />
          </section>

          <aside className="flex max-h-[560px] flex-col rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold text-vezzt-950">Filters</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Applied to map and list together.
            </p>
            <div className="mt-3 space-y-3 overflow-y-auto text-sm">
              <label className="block">
                <span className="text-xs text-neutral-500">Search</span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-vezzt-600"
                  placeholder="Name, city, category…"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-500">City</span>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                >
                  <option value="all">All cities</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-neutral-500">Category</span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                >
                  <option value="all">All categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-neutral-500">
                  Qualification status
                </span>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as "all" | QualificationStatus)
                  }
                  className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                >
                  <option value="all">All statuses</option>
                  <option value="qualified">qualified</option>
                  <option value="below_threshold">below_threshold</option>
                  <option value="excluded">excluded</option>
                  <option value="manual_review">manual_review</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-neutral-500">Min reviews</span>
                  <input
                    type="number"
                    min={0}
                    value={minReviews}
                    onChange={(e) => setMinReviews(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-neutral-500">Min rating</span>
                  <input
                    type="number"
                    min={0}
                    max={5}
                    step={0.1}
                    value={minRating}
                    onChange={(e) => setMinRating(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                    placeholder="0"
                  />
                </label>
              </div>
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              Showing {filtered.length} of {businesses.length}
              {missingOnMap.length > 0
                ? ` · ${missingOnMap.length} missing coordinates`
                : ""}
            </p>
          </aside>
        </div>

        {missingOnMap.length > 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {missingOnMap.length} filtered business
            {missingOnMap.length === 1 ? "" : "es"} cannot appear on the map
            (missing latitude/longitude):{" "}
            {missingOnMap.map((b) => b.name).join(", ")}
          </div>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-vezzt-950">
              Business list
            </h2>
            <p className="text-xs text-neutral-500">
              Sort: {sortKey} ({sortDir})
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  {(
                    [
                      ["name", "Business name"],
                      ["city", "City"],
                      ["category", "Primary category"],
                      ["averageRating", "Rating"],
                      ["reviewCount", "Reviews"],
                      ["status", "Status"],
                      ["growthScore", "Growth Score"],
                      ["vestimateMid", "Vestimate"],
                      ["confidence", "Confidence"],
                    ] as const
                  ).map(([key, label]) => {
                    const sortable =
                      key === "name" ||
                      key === "reviewCount" ||
                      key === "averageRating" ||
                      key === "growthScore" ||
                      key === "vestimateMid";
                    return (
                      <th key={key} className="px-3 py-2 font-medium">
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleSort(key as SortKey)}
                            className="hover:text-vezzt-700"
                          >
                            {label}
                            {sortKey === key
                              ? sortDir === "asc"
                                ? " ↑"
                                : " ↓"
                              : ""}
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr
                    key={b.id}
                    className={`border-t border-neutral-100 hover:bg-vezzt-50/60 ${
                      selectedId === b.id ? "bg-vezzt-50" : ""
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/businesses/${b.id}`}
                        className="font-medium text-vezzt-800 hover:underline"
                        onClick={() => setSelectedId(b.id)}
                      >
                        {b.name}
                      </Link>
                      {!b.hasCoordinates ? (
                        <span className="ml-2 text-[10px] uppercase text-amber-700">
                          no coords
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-700">
                      {b.city ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-700">
                      {b.primaryCategory ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-neutral-700">
                      {b.averageRating === null
                        ? "—"
                        : formatNullable(b.averageRating, { kind: "rating" })}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-neutral-700">
                      {b.reviewCount === null
                        ? "—"
                        : b.reviewCount.toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[b.qualificationStatus]}`}
                      >
                        {b.qualificationStatus.replace("_", " ")}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-neutral-500">
                      {formatNullable(b.growthScore)}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-700">
                      {formatNullable(b.vestimateMid, { kind: "currency" })}
                    </td>
                    <td className="px-3 py-2.5 text-neutral-500">
                      {formatNullable(b.confidenceScore)}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-3 py-10 text-center text-sm text-neutral-500"
                    >
                      No businesses match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
