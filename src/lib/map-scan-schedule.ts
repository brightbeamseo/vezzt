/**
 * LBM GeoGrid local-hours scheduling (business timezone).
 * Window: Mon–Fri 10:00–16:00 local. Uses IANA timezones (DST-aware).
 */

export const MAP_SCAN_SCHEDULE_RULE_VERSION = "v1-weekday-10to16-local";

export const MAP_SCAN_SCHEDULE_STATUSES = [
  "eligible",
  "waiting_for_window",
  "submitted",
  "pending",
  "finished",
  "failed",
  "timezone_missing",
] as const;

export type MapScanScheduleStatus = (typeof MAP_SCAN_SCHEDULE_STATUSES)[number];

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type LocalClockParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0=Sunday … 6=Saturday */
  weekday: number;
  weekdayShort: (typeof WEEKDAY_SHORT)[number];
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function getLocalClockParts(
  instant: Date,
  timeZone: string,
): LocalClockParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(instant)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;

  const weekdayShort = parts.weekday as (typeof WEEKDAY_SHORT)[number];
  const weekday = WEEKDAY_SHORT.indexOf(weekdayShort);
  if (weekday < 0) {
    throw new Error(`Unable to parse weekday "${parts.weekday}" in ${timeZone}`);
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday,
    weekdayShort,
  };
}

/**
 * Convert a wall-clock time in `timeZone` to a UTC Date (DST-aware).
 */
export function zonedLocalToUtc(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
): Date {
  const desiredAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  let utcMs = desiredAsUtcMs;

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let i = 0; i < 4; i++) {
    const parts = Object.fromEntries(
      dtf
        .formatToParts(new Date(utcMs))
        .filter((p) => p.type !== "literal")
        .map((p) => [p.type, p.value]),
    ) as Record<string, string>;
    const asUtcMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    utcMs += desiredAsUtcMs - asUtcMs;
  }

  return new Date(utcMs);
}

function addCalendarDays(
  year: number,
  month: number,
  day: number,
  delta: number,
): { year: number; month: number; day: number } {
  const base = new Date(Date.UTC(year, month - 1, day + delta));
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

function minutesSinceMidnight(hour: number, minute: number): number {
  return hour * 60 + minute;
}

const WINDOW_START_MIN = 10 * 60;
const WINDOW_END_MIN = 16 * 60;

export function formatLocalClock(parts: LocalClockParts): string {
  const ampm = parts.hour >= 12 ? "PM" : "AM";
  const h12 = parts.hour % 12 === 0 ? 12 : parts.hour % 12;
  return `${parts.weekdayShort} ${pad2(parts.month)}/${pad2(parts.day)}/${parts.year} ${h12}:${pad2(parts.minute)} ${ampm}`;
}

export type MapScanWindowEvaluation = {
  timeZone: string;
  eligible: boolean;
  local: LocalClockParts;
  requestedAtLocal: string;
  localWeekday: string;
  localHour: number;
  nextEligibleAt: Date;
  status: Extract<
    MapScanScheduleStatus,
    "eligible" | "waiting_for_window"
  >;
  waitReason: string | null;
  scheduleRuleVersion: string;
};

/**
 * Next Mon–Fri 10:00 local instant at or after the given local calendar day,
 * respecting the 10–16 window rules relative to `local`.
 */
export function computeNextEligibleAt(
  timeZone: string,
  local: LocalClockParts,
): Date {
  const mins = minutesSinceMidnight(local.hour, local.minute);

  // Before 10:00 on a weekday → today 10:00
  if (isWeekday(local.weekday) && mins < WINDOW_START_MIN) {
    return zonedLocalToUtc(
      timeZone,
      local.year,
      local.month,
      local.day,
      10,
      0,
      0,
    );
  }

  // Find next weekday (skip today if after window or weekend)
  let y = local.year;
  let m = local.month;
  let d = local.day;
  let wd = local.weekday;

  const afterWindow =
    !isWeekday(local.weekday) || mins > WINDOW_END_MIN;

  if (afterWindow || !isWeekday(local.weekday)) {
    // Advance at least one day when weekend or after 4pm
    ({ year: y, month: m, day: d } = addCalendarDays(y, m, d, 1));
    wd = (wd + 1) % 7;
  }

  // Skip weekends
  while (!isWeekday(wd)) {
    ({ year: y, month: m, day: d } = addCalendarDays(y, m, d, 1));
    wd = (wd + 1) % 7;
  }

  return zonedLocalToUtc(timeZone, y, m, d, 10, 0, 0);
}

/**
 * Evaluate whether `now` is inside the Mon–Fri 10:00–16:00 local window.
 */
export function evaluateMapScanWindow(
  now: Date,
  timeZone: string,
): MapScanWindowEvaluation {
  const local = getLocalClockParts(now, timeZone);
  const mins = minutesSinceMidnight(local.hour, local.minute);
  const inWeekday = isWeekday(local.weekday);
  const inHours = mins >= WINDOW_START_MIN && mins <= WINDOW_END_MIN;
  const eligible = inWeekday && inHours;
  const requestedAtLocal = formatLocalClock(local);

  if (eligible) {
    return {
      timeZone,
      eligible: true,
      local,
      requestedAtLocal,
      localWeekday: local.weekdayShort,
      localHour: local.hour,
      nextEligibleAt: now,
      status: "eligible",
      waitReason: null,
      scheduleRuleVersion: MAP_SCAN_SCHEDULE_RULE_VERSION,
    };
  }

  const nextEligibleAt = computeNextEligibleAt(timeZone, local);
  let waitReason: string;
  if (!inWeekday) {
    waitReason = `Weekend in ${timeZone} — next window Mon 10:00 AM local`;
  } else if (mins < WINDOW_START_MIN) {
    waitReason = `Before 10:00 AM in ${timeZone} — next window today 10:00 AM local`;
  } else {
    waitReason = `After 4:00 PM in ${timeZone} — next window next weekday 10:00 AM local`;
  }

  return {
    timeZone,
    eligible: false,
    local,
    requestedAtLocal,
    localWeekday: local.weekdayShort,
    localHour: local.hour,
    nextEligibleAt,
    status: "waiting_for_window",
    waitReason,
    scheduleRuleVersion: MAP_SCAN_SCHEDULE_RULE_VERSION,
  };
}

export type ResolvedMapScanTimezone = {
  timeZone: string | null;
  source: "business" | "market" | null;
};

export function resolveMapScanTimezone(input: {
  businessTimezone: string | null | undefined;
  marketTimezone: string | null | undefined;
}): ResolvedMapScanTimezone {
  const business = input.businessTimezone?.trim() || null;
  if (business) return { timeZone: business, source: "business" };
  const market = input.marketTimezone?.trim() || null;
  if (market) return { timeZone: market, source: "market" };
  return { timeZone: null, source: null };
}
