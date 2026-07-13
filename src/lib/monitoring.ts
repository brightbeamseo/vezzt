export type MonitoringTier = 1 | 2;

export type MonitoringFrequency = "weekly" | "monthly";

export type MonitoringAssignment = {
  monitoringTier: MonitoringTier | null;
  monitoringFrequency: MonitoringFrequency | null;
  nextMonitorAt: Date | null;
};

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * Monitoring for roofing contractors (primary category Roofing contractor):
 * Tier 1: 100+ reviews → weekly
 * Tier 2: below 100 reviews → monthly
 */
export function assignMonitoringTier(
  reviewCount: number | null,
  isRoofingSector: boolean,
  fromDate: Date = new Date(),
): MonitoringAssignment {
  if (!isRoofingSector) {
    return {
      monitoringTier: null,
      monitoringFrequency: null,
      nextMonitorAt: null,
    };
  }

  const count = reviewCount ?? 0;

  if (count >= 100) {
    return {
      monitoringTier: 1,
      monitoringFrequency: "weekly",
      nextMonitorAt: new Date(fromDate.getTime() + 7 * MS_DAY),
    };
  }

  return {
    monitoringTier: 2,
    monitoringFrequency: "monthly",
    nextMonitorAt: new Date(fromDate.getTime() + 30 * MS_DAY),
  };
}

export function nextMonitorDate(
  frequency: MonitoringFrequency,
  fromDate: Date = new Date(),
): Date {
  const days = frequency === "weekly" ? 7 : 30;
  return new Date(fromDate.getTime() + days * MS_DAY);
}
