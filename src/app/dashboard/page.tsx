import {
  buildDashboardSummary,
  getDashboardBusinesses,
} from "@/lib/dashboard-queries";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const businesses = await getDashboardBusinesses();
  const summary = buildDashboardSummary(businesses);

  return <DashboardShell businesses={businesses} summary={summary} />;
}
