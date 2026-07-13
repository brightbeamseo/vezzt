"use client";

import type { ReviewSnapshotSummary } from "@/lib/dashboard-types";

export function ReviewCountChart({
  snapshots,
}: {
  snapshots: ReviewSnapshotSummary[];
}) {
  const points = snapshots.filter((s) => s.reviewCount !== null);

  if (points.length < 2) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-4 py-6 text-sm text-neutral-600">
        Growth history has not been established yet. Only one review snapshot
        exists for this business. Additional scrape runs over time will unlock
        the review-count trend.
      </p>
    );
  }

  const width = 560;
  const height = 180;
  const pad = 28;
  const counts = points.map((p) => p.reviewCount as number);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const range = Math.max(max - min, 1);

  const coords = points.map((p, i) => {
    const x =
      pad + (i / Math.max(points.length - 1, 1)) * (width - pad * 2);
    const y =
      height -
      pad -
      (((p.reviewCount as number) - min) / range) * (height - pad * 2);
    return { x, y, label: p.snapshotDate, value: p.reviewCount as number };
  });

  const path = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(" ");

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full min-w-[320px]"
        role="img"
        aria-label="Review count over time"
      >
        <line
          x1={pad}
          y1={height - pad}
          x2={width - pad}
          y2={height - pad}
          stroke="#e5e5e5"
        />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#e5e5e5" />
        <path d={path} fill="none" stroke="#3730a3" strokeWidth={2.5} />
        {coords.map((c) => (
          <g key={c.label}>
            <circle cx={c.x} cy={c.y} r={4} fill="#3730a3" />
            <text
              x={c.x}
              y={height - 8}
              textAnchor="middle"
              className="fill-neutral-500"
              style={{ fontSize: 10 }}
            >
              {c.label}
            </text>
            <text
              x={c.x}
              y={c.y - 10}
              textAnchor="middle"
              className="fill-vezzt-900"
              style={{ fontSize: 10, fontWeight: 600 }}
            >
              {c.value}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
