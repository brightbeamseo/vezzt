"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  setManualQualification,
  type AdminBusinessRow,
} from "@/app/admin/qualification/actions";
import type { QualificationStatus } from "@/lib/qualification";

const STATUS_STYLES: Record<QualificationStatus, string> = {
  qualified: "bg-emerald-100 text-emerald-800",
  below_threshold: "bg-amber-100 text-amber-900",
  excluded: "bg-neutral-200 text-neutral-700",
  manual_review: "bg-sky-100 text-sky-900",
};

type Props = {
  businesses: AdminBusinessRow[];
  threshold: number;
};

export function QualificationAdminTable({ businesses, threshold }: Props) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | QualificationStatus>("all");

  const filtered =
    filter === "all"
      ? businesses
      : businesses.filter((b) => b.qualificationStatus === filter);

  function act(id: string, decision: "approve" | "reject") {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await setManualQualification(id, decision);
      setPendingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            "all",
            "manual_review",
            "qualified",
            "below_threshold",
            "excluded",
          ] as const
        ).map((key) => {
          const count =
            key === "all"
              ? businesses.length
              : businesses.filter((b) => b.qualificationStatus === key).length;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                filter === key
                  ? "bg-vezzt-950 text-white"
                  : "bg-white text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"
              }`}
            >
              {key.replace("_", " ")} ({count})
            </button>
          );
        })}
        <p className="ml-auto text-xs text-neutral-500">
          Review threshold: {threshold}
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-4 py-3 font-medium">Business</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium">Reviews</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Reason</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const busy = isPending && pendingId === row.id;
              return (
                <tr
                  key={row.id}
                  className="border-b border-neutral-100 align-top last:border-0"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-vezzt-950">{row.name}</p>
                    {row.websiteUrl ? (
                      <a
                        href={row.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-vezzt-600 hover:underline"
                      >
                        website
                      </a>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    {row.primaryCategory ?? "—"}
                  </td>
                  <td className="px-4 py-3 tabular-nums text-neutral-700">
                    {row.reviewCount ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.qualificationStatus]}`}
                    >
                      {row.qualificationStatus.replace("_", " ")}
                    </span>
                  </td>
                  <td className="max-w-md px-4 py-3 text-xs leading-relaxed text-neutral-600">
                    {row.qualificationReason ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1.5">
                      <button
                        type="button"
                        disabled={busy || row.qualificationStatus === "qualified"}
                        onClick={() => act(row.id, "approve")}
                        className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy || row.qualificationStatus === "excluded"}
                        onClick={() => act(row.id, "reject")}
                        className="rounded-md bg-neutral-800 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                      >
                        Reject
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-neutral-500"
                >
                  No businesses in this filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
