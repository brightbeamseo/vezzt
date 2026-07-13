"use client";

import type { DashboardSummary } from "@/lib/dashboard-types";
import { formatNullable } from "@/lib/format";

const CARDS: {
  key: keyof DashboardSummary;
  label: string;
  format: "integer" | "rating" | "raw";
}[] = [
  { key: "totalBusinesses", label: "Total businesses", format: "integer" },
  { key: "withReviewData", label: "With review data", format: "integer" },
  { key: "averageReviewCount", label: "Avg review count", format: "integer" },
  { key: "averageRating", label: "Avg rating", format: "rating" },
  { key: "highestReviewCount", label: "Highest review count", format: "integer" },
  { key: "qualifiedCount", label: "Qualified", format: "integer" },
  { key: "belowThresholdCount", label: "Below threshold", format: "integer" },
];

export function DashboardSummaryCards({ summary }: { summary: DashboardSummary }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {CARDS.map((card) => {
        const value = summary[card.key];
        let display: string;
        if (value === null || value === undefined) {
          display = "Not calculated";
        } else if (card.format === "rating") {
          display = formatNullable(value, { kind: "rating" });
        } else if (card.format === "integer" && typeof value === "number") {
          display =
            card.key === "averageReviewCount"
              ? value.toFixed(1)
              : Math.round(value).toLocaleString("en-US");
        } else {
          display = String(value);
        }

        return (
          <div
            key={card.key}
            className="rounded-xl border border-neutral-200 bg-white px-3 py-3 shadow-sm"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
              {card.label}
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-vezzt-950">
              {display}
            </p>
          </div>
        );
      })}
    </div>
  );
}
