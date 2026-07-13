"use client";

import dynamic from "next/dynamic";
import type { DashboardBusiness } from "@/lib/dashboard-types";

const DashboardMap = dynamic(
  () =>
    import("@/components/dashboard/dashboard-map").then((m) => m.DashboardMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-xl bg-neutral-100 text-sm text-neutral-500">
        Loading map…
      </div>
    ),
  },
);

type Props = {
  businesses: DashboardBusiness[];
  onSelect: (business: DashboardBusiness) => void;
  selectedId: string | null;
};

export function DashboardMapWrapper(props: Props) {
  return <DashboardMap {...props} />;
}
