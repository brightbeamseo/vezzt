import Link from "next/link";
import { getBoiseRoofingComparison } from "@/lib/dashboard-queries";
import { formatGridRank, formatSeoMetric } from "@/lib/format";

export const dynamic = "force-dynamic";

function cell(value: string) {
  const empty =
    value === "—" ||
    value === "Not available" ||
    value === "pending" ||
    value === "processing";
  return (
    <td
      className={`whitespace-nowrap px-3 py-2 text-sm tabular-nums ${
        empty ? "text-neutral-400" : "text-vezzt-950"
      }`}
    >
      {value}
    </td>
  );
}

export default async function BoiseRoofingComparisonPage() {
  const rows = await getBoiseRoofingComparison();

  return (
    <div className="min-h-screen bg-neutral-100">
      <header className="border-b border-neutral-200 bg-vezzt-950 px-4 py-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-vezzt-300">
              Comparison
            </p>
            <h1 className="text-xl font-semibold tracking-tight">
              Boise Roofing
            </h1>
            <p className="mt-1 text-sm text-vezzt-200">
              Qualified Boise Metro roofing contractors with 100+ reviews.
              Shows latest Ahrefs + GeoGrid snapshot fields only — no proprietary
              scores.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard"
              className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-100 hover:bg-vezzt-900"
            >
              ← Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
        <p className="mb-4 text-sm text-neutral-600">
          {rows.length} businesses in cohort
        </p>
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
          <table className="min-w-full text-left">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-3 font-medium">Business</th>
                <th className="px-3 py-3 font-medium">Reviews</th>
                <th className="px-3 py-3 font-medium">Rating</th>
                <th className="px-3 py-3 font-medium">Domain Rating</th>
                <th className="px-3 py-3 font-medium">Organic Traffic</th>
                <th className="px-3 py-3 font-medium">Organic Keywords</th>
                <th className="px-3 py-3 font-medium">Referring Domains</th>
                <th className="px-3 py-3 font-medium">SoLV</th>
                <th className="px-3 py-3 font-medium">AGR</th>
                <th className="px-3 py-3 font-medium">Top-3</th>
                <th className="px-3 py-3 font-medium">Data completeness</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-neutral-100">
                  <td className="px-3 py-2 text-sm">
                    <Link
                      href={`/businesses/${row.id}`}
                      className="font-medium text-vezzt-700 underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <div className="text-xs text-neutral-500">
                      {row.city ?? "—"}
                    </div>
                  </td>
                  {cell(
                    row.reviewCount === null
                      ? "—"
                      : row.reviewCount.toLocaleString("en-US"),
                  )}
                  {cell(
                    row.averageRating === null
                      ? "—"
                      : row.averageRating.toFixed(1),
                  )}
                  {cell(formatSeoMetric(row.domainRating, { digits: 1 }))}
                  {cell(
                    formatSeoMetric(row.organicTraffic, { kind: "integer" }),
                  )}
                  {cell(
                    formatSeoMetric(row.organicKeywords, { kind: "integer" }),
                  )}
                  {cell(
                    formatSeoMetric(row.referringDomains, { kind: "integer" }),
                  )}
                  {cell(
                    row.mapRankStatus === "pending" ||
                      row.mapRankStatus === "processing"
                      ? row.mapRankStatus
                      : row.shareOfLocalVoice === null
                        ? "—"
                        : `${(row.shareOfLocalVoice * 100).toFixed(1)}%`,
                  )}
                  {cell(
                    row.mapRankStatus === "pending" ||
                      row.mapRankStatus === "processing"
                      ? row.mapRankStatus
                      : formatGridRank(row.averageGridRank),
                  )}
                  {cell(
                    row.mapRankStatus === "pending" ||
                      row.mapRankStatus === "processing"
                      ? row.mapRankStatus
                      : row.foundInTop3Count === null ||
                          row.totalGridPoints === null
                        ? "—"
                        : `${row.foundInTop3Count} / ${row.totalGridPoints}`,
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-sm">
                    <span className="font-medium tabular-nums text-vezzt-950">
                      {row.dataCompleteness}%
                    </span>
                    {row.missingFields.length > 0 ? (
                      <div className="mt-0.5 max-w-[12rem] truncate text-[11px] text-amber-700">
                        missing: {row.missingFields.join(", ")}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
