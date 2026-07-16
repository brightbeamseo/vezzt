"use client";

import { useMemo, useState } from "react";
import type { ReviewAnalytics, ReviewMonthlyStat } from "@/lib/review-analytics";
import {
  calculateRolling90DayVelocity,
} from "@/lib/review-analytics";

export type ReviewHistoryTableRow = {
  id: string;
  publishedAt: string;
  rating: number | null;
  reviewText: string | null;
  ownerResponseDate: string | null;
  ownerResponseText: string | null;
};

export type ReviewHistoryProps = {
  analytics: ReviewAnalytics;
  monthly: ReviewMonthlyStat[];
  reviews: ReviewHistoryTableRow[];
  googleSnapshotCount: number | null;
};

type RangeKey = "12m" | "24m" | "5y" | "all";

function formatMonthLabel(month: string): string {
  const d = new Date(`${month.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function filterMonths(
  monthly: ReviewMonthlyStat[],
  range: RangeKey,
): ReviewMonthlyStat[] {
  if (range === "all" || monthly.length === 0) return monthly;
  const last = monthly[monthly.length - 1]!;
  const end = new Date(`${last.month}T00:00:00Z`);
  const start = new Date(end);
  if (range === "12m") start.setUTCMonth(start.getUTCMonth() - 11);
  else if (range === "24m") start.setUTCMonth(start.getUTCMonth() - 23);
  else start.setUTCFullYear(start.getUTCFullYear() - 5);
  const startKey = start.toISOString().slice(0, 10);
  return monthly.filter((m) => m.month >= startKey);
}

function formatPct(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatNum(n: number | null, digits = 1): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function formatRate(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function LineChart({
  points,
  yLabel,
  ariaLabel,
  color = "#3730a3",
}: {
  points: { x: string; y: number }[];
  yLabel: string;
  ariaLabel: string;
  color?: string;
}) {
  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        No data for this range.
      </p>
    );
  }

  const width = 640;
  const height = 200;
  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const ys = points.map((p) => p.y);
  const minY = Math.min(...ys, 0);
  const maxY = Math.max(...ys);
  const rangeY = Math.max(maxY - minY, 0.0001);

  const coords = points.map((p, i) => {
    const x =
      padL +
      (i / Math.max(points.length - 1, 1)) * (width - padL - padR);
    const y =
      height - padB - ((p.y - minY) / rangeY) * (height - padT - padB);
    return { ...p, cx: x, cy: y };
  });

  const path = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.cx.toFixed(1)} ${c.cy.toFixed(1)}`)
    .join(" ");

  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] text-neutral-500">{yLabel}</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-52 w-full min-w-[320px]"
        role="img"
        aria-label={ariaLabel}
      >
        <line
          x1={padL}
          y1={height - padB}
          x2={width - padR}
          y2={height - padB}
          stroke="#e5e5e5"
        />
        <line
          x1={padL}
          y1={padT}
          x2={padL}
          y2={height - padB}
          stroke="#e5e5e5"
        />
        <path d={path} fill="none" stroke={color} strokeWidth={2.25} />
        {coords.map((c, i) => (
          <g key={`${c.x}-${i}`}>
            <circle cx={c.cx} cy={c.cy} r={3} fill={color} />
            {i % labelEvery === 0 || i === coords.length - 1 ? (
              <text
                x={c.cx}
                y={height - 10}
                textAnchor="middle"
                className="fill-neutral-500"
                style={{ fontSize: 10 }}
              >
                {formatMonthLabel(c.x)}
              </text>
            ) : null}
          </g>
        ))}
        <text
          x={padL - 6}
          y={padT + 4}
          textAnchor="end"
          className="fill-neutral-500"
          style={{ fontSize: 10 }}
        >
          {maxY.toFixed(maxY >= 10 ? 0 : 1)}
        </text>
        <text
          x={padL - 6}
          y={height - padB}
          textAnchor="end"
          className="fill-neutral-500"
          style={{ fontSize: 10 }}
        >
          {minY.toFixed(minY >= 10 ? 0 : 1)}
        </text>
      </svg>
    </div>
  );
}

function BarChart({
  points,
  yLabel,
  ariaLabel,
}: {
  points: { x: string; y: number }[];
  yLabel: string;
  ariaLabel: string;
}) {
  if (points.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        No data for this range.
      </p>
    );
  }

  const width = 640;
  const height = 200;
  const padL = 44;
  const padR = 16;
  const padT = 20;
  const padB = 36;
  const maxY = Math.max(...points.map((p) => p.y), 1);
  const barGap = 2;
  const innerW = width - padL - padR;
  const barW = Math.max(2, innerW / points.length - barGap);
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="overflow-x-auto">
      <p className="mb-1 text-[11px] text-neutral-500">{yLabel}</p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-52 w-full min-w-[320px]"
        role="img"
        aria-label={ariaLabel}
      >
        <line
          x1={padL}
          y1={height - padB}
          x2={width - padR}
          y2={height - padB}
          stroke="#e5e5e5"
        />
        {points.map((p, i) => {
          const x = padL + i * (barW + barGap);
          const h = (p.y / maxY) * (height - padT - padB);
          const y = height - padB - h;
          return (
            <g key={`${p.x}-${i}`}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, 1)}
                fill="#4f46e5"
                opacity={0.85}
              />
              {i % labelEvery === 0 || i === points.length - 1 ? (
                <text
                  x={x + barW / 2}
                  y={height - 10}
                  textAnchor="middle"
                  className="fill-neutral-500"
                  style={{ fontSize: 10 }}
                >
                  {formatMonthLabel(p.x)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-vezzt-950">
        {value}
      </p>
    </div>
  );
}

export function ReviewHistorySection({
  analytics,
  monthly,
  reviews,
  googleSnapshotCount,
}: ReviewHistoryProps) {
  const [range, setRange] = useState<RangeKey>("12m");
  const [tableOpen, setTableOpen] = useState(false);

  const filtered = useMemo(
    () => filterMonths(monthly, range),
    [monthly, range],
  );

  const rolling = useMemo(() => {
    const records = reviews.map((r) => ({
      publishedAt: new Date(r.publishedAt),
      rating: r.rating,
      ownerResponseText: r.ownerResponseText,
      ownerResponseDate: r.ownerResponseDate
        ? new Date(r.ownerResponseDate)
        : null,
    }));
    return calculateRolling90DayVelocity(
      records,
      filtered.map((m) => m.month),
    );
  }, [reviews, filtered]);

  const mismatch =
    googleSnapshotCount === null
      ? null
      : googleSnapshotCount - analytics.totalImportedReviews;

  if (analytics.totalImportedReviews === 0) {
    return (
      <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-vezzt-950">Review History</h2>
        <p className="mt-2 text-sm text-neutral-600">
          Individual review history has not been collected for this business yet.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-vezzt-950">
            Review History
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Imported Google reviews (raw metrics — no proprietary velocity
            score). Snapshot count{" "}
            {googleSnapshotCount === null
              ? "—"
              : googleSnapshotCount.toLocaleString("en-US")}
            {mismatch !== null ? (
              <>
                {" "}
                · imported Δ {mismatch > 0 ? `−${mismatch}` : `+${Math.abs(mismatch)}`}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["12m", "12 months"],
              ["24m", "24 months"],
              ["5y", "5 years"],
              ["all", "All time"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setRange(key)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                range === key
                  ? "bg-vezzt-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Imported reviews"
          value={analytics.totalImportedReviews.toLocaleString("en-US")}
        />
        <MetricCard
          label="Reviews last 30 days"
          value={String(analytics.reviewsLast30Days)}
        />
        <MetricCard
          label="Reviews last 90 days"
          value={String(analytics.reviewsLast90Days)}
        />
        <MetricCard
          label="Reviews last 12 months"
          value={String(analytics.reviewsLast365Days)}
        />
        <MetricCard
          label="90-day monthly velocity"
          value={formatNum(analytics.current90DayMonthlyVelocity)}
        />
        <MetricCard
          label="12-month monthly velocity"
          value={formatNum(analytics.avgReviewsPerMonth365d)}
        />
        <MetricCard
          label="Review momentum"
          value={formatPct(analytics.reviewMomentumPct)}
        />
        <MetricCard
          label="Owner response rate"
          value={formatRate(analytics.ownerResponseRate)}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            A. Cumulative Reviews Over Time
          </h3>
          <LineChart
            points={filtered.map((m) => ({
              x: m.month,
              y: m.cumulativeReviewCount,
            }))}
            yLabel="Cumulative imported reviews"
            ariaLabel="Cumulative reviews over time"
          />
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            B. Reviews Received by Month
          </h3>
          <BarChart
            points={filtered.map((m) => ({
              x: m.month,
              y: m.reviewsReceived,
            }))}
            yLabel="Reviews received"
            ariaLabel="Reviews received by month"
          />
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            C. Rolling Review Velocity
          </h3>
          <p className="mb-1 text-[11px] text-neutral-500">
            Rolling 90-day reviews ÷ 3 (monthly rate), evaluated at each month
            end.
          </p>
          <LineChart
            points={rolling.map((r) => ({ x: r.month, y: r.velocity }))}
            yLabel="Reviews / month (90-day rolling)"
            ariaLabel="Rolling 90-day review velocity"
            color="#0f766e"
          />
        </div>
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-600">
            D. Average Rating by Month
          </h3>
          <LineChart
            points={filtered
              .filter((m) => m.averageRating !== null && m.reviewsReceived > 0)
              .map((m) => ({
                x: m.month,
                y: m.averageRating as number,
              }))}
            yLabel="Average rating (months with reviews)"
            ariaLabel="Average rating by month"
            color="#b45309"
          />
        </div>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={() => setTableOpen((o) => !o)}
          className="text-sm font-medium text-vezzt-800 hover:underline"
        >
          {tableOpen ? "Hide" : "Show"} internal review table (
          {reviews.length.toLocaleString("en-US")})
        </button>
        {tableOpen ? (
          <div className="mt-3 max-h-[28rem] overflow-auto rounded-lg border border-neutral-200">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Rating</th>
                  <th className="px-3 py-2">Review</th>
                  <th className="px-3 py-2">Owner response date</th>
                  <th className="px-3 py-2">Owner response</th>
                </tr>
              </thead>
              <tbody>
                {[...reviews]
                  .sort(
                    (a, b) =>
                      new Date(b.publishedAt).getTime() -
                      new Date(a.publishedAt).getTime(),
                  )
                  .map((r) => (
                    <tr key={r.id} className="border-t border-neutral-100 align-top">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-neutral-700">
                        {r.publishedAt.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {r.rating ?? "—"}
                      </td>
                      <td className="max-w-md px-3 py-2 text-neutral-700">
                        {r.reviewText || (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-neutral-700">
                        {r.ownerResponseDate
                          ? r.ownerResponseDate.slice(0, 10)
                          : "—"}
                      </td>
                      <td className="max-w-md px-3 py-2 text-neutral-700">
                        {r.ownerResponseText || (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}
