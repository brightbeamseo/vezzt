"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { Building2, LogOut, Search } from "lucide-react";
import { formatNullable } from "@/lib/format";
import type { Business } from "@/lib/types";
import { BusinessMapWrapper } from "@/components/business-map-wrapper";
import { BusinessPanel } from "@/components/business-panel";

type AppShellProps = {
  businesses: Business[];
};

export function AppShell({ businesses }: AppShellProps) {
  const [selected, setSelected] = useState<Business | null>(null);
  const [search, setSearch] = useState("");

  const filtered = businesses.filter(
    (b) =>
      b.name.toLowerCase().includes(search.toLowerCase()) ||
      b.category.toLowerCase().includes(search.toLowerCase()) ||
      b.city.toLowerCase().includes(search.toLowerCase()) ||
      (b.qualificationStatus ?? "")
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-screen flex-col bg-vezzt-50">
      <header className="flex shrink-0 items-center justify-between border-b border-neutral-200 bg-vezzt-950 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-vezzt-600 text-white">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-white">
              Vezzt
            </p>
            <p className="text-xs text-vezzt-300">
              Because your business has value.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/dashboard"
            className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-200 transition hover:bg-vezzt-900"
          >
            Dashboard
          </a>
          <a
            href="/admin/qualification"
            className="rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-200 transition hover:bg-vezzt-900"
          >
            Qualification
          </a>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="flex items-center gap-1.5 rounded-lg border border-vezzt-700 px-3 py-1.5 text-xs font-medium text-vezzt-200 transition hover:bg-vezzt-900"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-80 shrink-0 flex-col border-r border-neutral-200 bg-white">
          <div className="border-b border-neutral-200 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search businesses..."
                className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-vezzt-950 outline-none focus:border-vezzt-600 focus:ring-2 focus:ring-vezzt-600/20"
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              {filtered.length} business{filtered.length !== 1 ? "es" : ""}{" "}
              listed (all statuses)
            </p>
          </div>

          <ul className="flex-1 overflow-y-auto">
            {filtered.map((business) => (
              <li key={business.id}>
                <button
                  onClick={() => setSelected(business)}
                  className={`w-full border-b border-neutral-100 px-4 py-3 text-left transition hover:bg-vezzt-50 ${
                    selected?.id === business.id
                      ? "border-l-2 border-l-vezzt-600 bg-vezzt-50"
                      : "border-l-2 border-l-transparent"
                  }`}
                >
                  <p className="business-name-list text-vezzt-950">
                    {business.name}
                  </p>
                  <p className="text-xs text-neutral-500">
                    {business.category} · {business.city}, {business.state}
                  </p>
                  <p className="mt-1 text-[11px] capitalize text-neutral-400">
                    {(business.qualificationStatus ?? "unknown").replace(
                      "_",
                      " ",
                    )}
                    {business.reviewCount !== null
                      ? ` · ${business.reviewCount} reviews`
                      : ""}
                  </p>
                  <p className="mt-1 text-xs font-bold text-vezzt-600">
                    Vestimate{" "}
                    {formatNullable(business.vestimate, { kind: "currency" })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className="relative min-w-0 flex-1">
          <BusinessMapWrapper
            businesses={filtered}
            selected={selected}
            onSelect={setSelected}
          />
        </main>

        <aside className="w-[28rem] shrink-0 border-l border-neutral-200 bg-white">
          <BusinessPanel business={selected} />
        </aside>
      </div>
    </div>
  );
}
