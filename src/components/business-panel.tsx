import type { Business } from "@/lib/types";
import { formatNullable } from "@/lib/format";
import {
  Building2,
  Calendar,
  DollarSign,
  MapPin,
  Ruler,
  Users,
} from "lucide-react";
import Link from "next/link";

type BusinessPanelProps = {
  business: Business | null;
};

export function BusinessPanel({ business }: BusinessPanelProps) {
  if (!business) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
          <MapPin className="h-5 w-5 text-neutral-400" />
        </div>
        <p className="text-sm font-medium text-vezzt-950">
          Select a business on the map
        </p>
        <p className="mt-1 max-w-xs text-xs text-neutral-500">
          Click a marker or choose from the list to view its Vestimate and
          details.
        </p>
      </div>
    );
  }

  const stats = [
    {
      label: "Annual Revenue",
      value: formatNullable(business.annualRevenue, { kind: "currency" }),
      icon: DollarSign,
    },
    {
      label: "Employees",
      value: formatNullable(business.employees, { kind: "integer" }),
      icon: Users,
    },
    {
      label: "Founded",
      value: formatNullable(business.founded, { kind: "integer" }),
      icon: Calendar,
    },
    {
      label: "Sq Ft",
      value: formatNullable(business.sqft, { kind: "integer" }),
      icon: Ruler,
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-neutral-200 p-5">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-vezzt-600">
          <Building2 className="h-3.5 w-3.5" />
          {business.category}
        </div>
        <h2 className="business-name text-vezzt-950">{business.name}</h2>
        <p className="mt-1 flex items-center gap-1 text-sm text-neutral-500">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {business.address}, {business.city}, {business.state}
        </p>
        <p className="mt-2 text-xs capitalize text-neutral-500">
          Status:{" "}
          {(business.qualificationStatus ?? "unknown").replace("_", " ")}
          {business.reviewCount !== null
            ? ` · ${business.reviewCount} reviews`
            : ""}
        </p>
      </div>

      <div className="border-b border-vezzt-800 bg-vezzt-900 p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-vezzt-100">
          Vestimate
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-white">
          {formatNullable(business.vestimate, { kind: "currency" })}
        </p>
        <p className="mt-1 text-xs text-vezzt-100/80">
          {business.vestimate === null
            ? "Not calculated yet — scoring formulas are still under development."
            : "Estimated business valuation based on revenue, location, and market data."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-neutral-200 p-5">
        {stats.map(({ label, value, icon: Icon }) => (
          <div
            key={label}
            className="rounded-lg border border-neutral-200 bg-white p-3"
          >
            <div className="mb-1 flex items-center gap-1.5 text-xs text-neutral-500">
              <Icon className="h-3 w-3" />
              {label}
            </div>
            <p className="text-sm font-semibold text-vezzt-950">{value}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        <h3 className="mb-2 text-sm font-semibold text-vezzt-950">About</h3>
        <p className="text-sm leading-relaxed text-neutral-600">
          {business.description || "No description yet."}
        </p>
        <Link
          href={`/businesses/${business.id}`}
          className="mt-4 inline-block text-sm font-medium text-vezzt-600 hover:underline"
        >
          Open full detail →
        </Link>
      </div>
    </div>
  );
}
