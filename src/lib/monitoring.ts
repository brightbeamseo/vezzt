export type MonitoringTier = 1 | 2 | 3;

export type MonitoringFrequency = "weekly" | "monthly" | "quarterly";

export type MonitoringAssignment = {
  monitoringTier: MonitoringTier | null;
  monitoringFrequency: MonitoringFrequency | null;
  nextMonitorAt: Date | null;
};

const MS_DAY = 24 * 60 * 60 * 1000;

/**
 * Assign monitoring tier for roofing-sector businesses.
 * Tier 1: 100+ reviews → weekly
 * Tier 2: 25–99 → monthly
 * Tier 3: <25 → quarterly
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
  let monitoringTier: MonitoringTier;
  let monitoringFrequency: MonitoringFrequency;
  let days: number;

  if (count >= 100) {
    monitoringTier = 1;
    monitoringFrequency = "weekly";
    days = 7;
  } else if (count >= 25) {
    monitoringTier = 2;
    monitoringFrequency = "monthly";
    days = 30;
  } else {
    monitoringTier = 3;
    monitoringFrequency = "quarterly";
    days = 90;
  }

  return {
    monitoringTier,
    monitoringFrequency,
    nextMonitorAt: new Date(fromDate.getTime() + days * MS_DAY),
  };
}

export function nextMonitorDate(
  frequency: MonitoringFrequency,
  fromDate: Date = new Date(),
): Date {
  const days =
    frequency === "weekly" ? 7 : frequency === "monthly" ? 30 : 90;
  return new Date(fromDate.getTime() + days * MS_DAY);
}
