import type { Client } from "pg";
import { connectAdminPg } from "@/lib/admin-db";
import {
  createLbmGeogrid,
  extractSubjectMetrics,
  fetchLbmGeogrid,
  type LbmGeogridCompetitor,
  type LbmGeogridPayload,
} from "@/lib/lbm-geogrid";
import {
  evaluateMapScanWindow,
  MAP_SCAN_SCHEDULE_RULE_VERSION,
  resolveMapScanTimezone,
  type MapScanScheduleStatus,
} from "@/lib/map-scan-schedule";
import { MARKETS } from "@/lib/markets";

export type MapRankSnapshotRow = {
  id: string;
  businessId: string;
  provider: string;
  providerScanId: string;
  businessPlaceId: string;
  searchTerm: string;
  scannedAt: string | null;
  gridSize: number | null;
  spacingValue: number | null;
  spacingUnit: string | null;
  averageGridRank: number | null;
  averageTotalGridRank: number | null;
  shareOfLocalVoice: number | null;
  foundInTop3Count: number | null;
  foundInTop10Count: number | null;
  totalGridPoints: number | null;
  ranks: unknown;
  competitors: unknown;
  status: string | null;
  errorMessage?: string | null;
};

function isNumericRank(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Count cells where rank is in 1..maxRank (ignore X / null / strings). */
export function countRanksInRange(
  ranks: unknown,
  maxRank: number,
): { count: number; totalPoints: number } {
  if (!Array.isArray(ranks)) return { count: 0, totalPoints: 0 };
  let count = 0;
  let totalPoints = 0;
  for (const row of ranks) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      totalPoints += 1;
      if (isNumericRank(cell) && cell >= 1 && cell <= maxRank) {
        count += 1;
      }
    }
  }
  return { count, totalPoints };
}

export function competitorPlaceIds(
  competitors: LbmGeogridCompetitor[] | null | undefined,
): string[] {
  return (competitors ?? [])
    .map((c) => c.place_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function insertPendingMapRankSnapshot(input: {
  businessId: string;
  businessPlaceId: string;
  providerScanId: string;
  searchTerm: string;
  gridSize: number;
  spacingValue: number;
  spacingUnit: string;
  locationTimezone?: string | null;
  requestedAtUtc?: Date | null;
  requestedAtLocal?: string | null;
  localWeekday?: string | null;
  localHour?: number | null;
  scheduleRuleVersion?: string | null;
  client?: Client;
}): Promise<string> {
  const owns = !input.client;
  const db = input.client ?? (await connectAdminPg());
  try {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.map_rank_snapshots (
        business_id, provider, provider_scan_id, business_place_id,
        search_term, grid_size, spacing_value, spacing_unit,
        total_grid_points, status, competitors, ranks,
        location_timezone, requested_at_utc, requested_at_local,
        local_weekday, local_hour, schedule_rule_version
      ) values (
        $1, 'local_brand_manager', $2, $3,
        $4, $5, $6, $7,
        $8, 'pending', '[]'::jsonb, null,
        $9, coalesce($10::timestamptz, now()), $11,
        $12, $13, $14
      )
      on conflict (provider, provider_scan_id) do update set
        status = 'pending',
        location_timezone = coalesce(excluded.location_timezone, map_rank_snapshots.location_timezone),
        requested_at_utc = coalesce(excluded.requested_at_utc, map_rank_snapshots.requested_at_utc),
        requested_at_local = coalesce(excluded.requested_at_local, map_rank_snapshots.requested_at_local),
        local_weekday = coalesce(excluded.local_weekday, map_rank_snapshots.local_weekday),
        local_hour = coalesce(excluded.local_hour, map_rank_snapshots.local_hour),
        schedule_rule_version = coalesce(excluded.schedule_rule_version, map_rank_snapshots.schedule_rule_version)
      returning id`,
      [
        input.businessId,
        input.providerScanId,
        input.businessPlaceId,
        input.searchTerm,
        input.gridSize,
        input.spacingValue,
        input.spacingUnit,
        input.gridSize * input.gridSize,
        input.locationTimezone ?? null,
        input.requestedAtUtc?.toISOString() ?? null,
        input.requestedAtLocal ?? null,
        input.localWeekday ?? null,
        input.localHour ?? null,
        input.scheduleRuleVersion ?? MAP_SCAN_SCHEDULE_RULE_VERSION,
      ],
    );
    return rows[0].id;
  } finally {
    if (owns) await db.end();
  }
}

async function updateBusinessMapScanSchedule(
  db: Client,
  businessId: string,
  fields: {
    timezone: string | null;
    status: MapScanScheduleStatus;
    nextEligibleAt: Date | null;
    localTime: string | null;
    waitReason: string | null;
    lastRequestedAt?: Date | null;
  },
): Promise<void> {
  await db.query(
    `update public.businesses set
      map_scan_timezone = coalesce($2, map_scan_timezone),
      timezone = coalesce(timezone, $2),
      map_scan_schedule_status = $3,
      map_scan_next_eligible_at = $4,
      map_scan_local_time = $5,
      map_scan_wait_reason = $6,
      map_scan_last_requested_at = coalesce($7, map_scan_last_requested_at),
      updated_at = now()
     where id = $1`,
    [
      businessId,
      fields.timezone,
      fields.status,
      fields.nextEligibleAt?.toISOString() ?? null,
      fields.localTime,
      fields.waitReason,
      fields.lastRequestedAt?.toISOString() ?? null,
    ],
  );
}

export async function completeMapRankSnapshot(input: {
  providerScanId: string;
  businessPlaceId: string;
  payload: LbmGeogridPayload;
  client?: Client;
}): Promise<MapRankSnapshotRow> {
  if (
    input.payload.business_place_id &&
    input.payload.business_place_id !== input.businessPlaceId
  ) {
    throw new Error(
      `Place ID mismatch: expected ${input.businessPlaceId}, got ${input.payload.business_place_id}`,
    );
  }

  const metrics = extractSubjectMetrics(input.payload, input.businessPlaceId);
  const { count: top3, totalPoints } = countRanksInRange(metrics.ranks, 3);
  const { count: top10 } = countRanksInRange(metrics.ranks, 10);
  const status =
    input.payload.state === "finished"
      ? "finished"
      : input.payload.state === "error"
        ? "failed"
        : (input.payload.state ?? "unknown");

  const owns = !input.client;
  const db = input.client ?? (await connectAdminPg());
  try {
    const { rows } = await db.query<{
      id: string;
      business_id: string;
      provider: string;
      provider_scan_id: string;
      business_place_id: string;
      search_term: string;
      scanned_at: string | null;
      grid_size: number | null;
      spacing_value: string | null;
      spacing_unit: string | null;
      average_grid_rank: string | null;
      average_total_grid_rank: string | null;
      share_of_local_voice: string | null;
      found_in_top_3_count: number | null;
      found_in_top_10_count: number | null;
      total_grid_points: number | null;
      ranks: unknown;
      competitors: unknown;
      status: string | null;
    }>(
      `update public.map_rank_snapshots set
        scanned_at = coalesce($2::timestamptz, now()),
        average_grid_rank = $3,
        average_total_grid_rank = $4,
        share_of_local_voice = $5,
        found_in_top_3_count = $6,
        found_in_top_10_count = $7,
        total_grid_points = $8,
        ranks = $9::jsonb,
        competitors = $10::jsonb,
        raw_response = $11::jsonb,
        status = $12,
        search_term = coalesce(nullif($13, ''), search_term),
        grid_size = coalesce($14, grid_size),
        spacing_value = coalesce($15, spacing_value),
        spacing_unit = coalesce($16, spacing_unit)
      where provider = 'local_brand_manager'
        and provider_scan_id = $1
      returning *`,
      [
        input.providerScanId,
        input.payload.finished_at ?? input.payload.created_at ?? null,
        metrics.agr,
        metrics.atgr,
        metrics.solv,
        top3,
        top10,
        totalPoints ||
          (input.payload.grid_size
            ? input.payload.grid_size * input.payload.grid_size
            : null),
        JSON.stringify(metrics.ranks),
        JSON.stringify(input.payload.competitors ?? []),
        JSON.stringify(input.payload),
        status,
        input.payload.search_term ?? "",
        input.payload.grid_size ?? null,
        input.payload.grid_point_distance ?? null,
        input.payload.grid_distance_measure ?? null,
      ],
    );

    if (!rows[0]) {
      throw new Error(
        `No map_rank_snapshots row for provider_scan_id=${input.providerScanId}`,
      );
    }

    const r = rows[0];
    return {
      id: r.id,
      businessId: r.business_id,
      provider: r.provider,
      providerScanId: r.provider_scan_id,
      businessPlaceId: r.business_place_id,
      searchTerm: r.search_term,
      scannedAt: r.scanned_at,
      gridSize: r.grid_size,
      spacingValue: r.spacing_value === null ? null : Number(r.spacing_value),
      spacingUnit: r.spacing_unit,
      averageGridRank:
        r.average_grid_rank === null ? null : Number(r.average_grid_rank),
      averageTotalGridRank:
        r.average_total_grid_rank === null
          ? null
          : Number(r.average_total_grid_rank),
      shareOfLocalVoice:
        r.share_of_local_voice === null
          ? null
          : Number(r.share_of_local_voice),
      foundInTop3Count: r.found_in_top_3_count,
      foundInTop10Count: r.found_in_top_10_count,
      totalGridPoints: r.total_grid_points,
      ranks: r.ranks,
      competitors: r.competitors,
      status: r.status,
    };
  } finally {
    if (owns) await db.end();
  }
}

export async function markMapRankSnapshotFailed(input: {
  providerScanId: string;
  errorMessage: string;
  raw?: unknown;
  client?: Client;
}): Promise<void> {
  const owns = !input.client;
  const db = input.client ?? (await connectAdminPg());
  try {
    await db.query(
      `update public.map_rank_snapshots set
        status = 'failed',
        raw_response = coalesce($2::jsonb, raw_response),
        scanned_at = coalesce(scanned_at, now())
      where provider = 'local_brand_manager'
        and provider_scan_id = $1`,
      [
        input.providerScanId,
        input.raw
          ? JSON.stringify({ error: input.errorMessage, raw: input.raw })
          : JSON.stringify({ error: input.errorMessage }),
      ],
    );
  } finally {
    if (owns) await db.end();
  }
}

/**
 * Start one LBM GeoGrid: create remote scan + pending DB row, then return.
 * Does not poll. Use checkLbmGeogridOnce() later.
 *
 * Enforces Mon–Fri 10:00–16:00 in the business location timezone unless
 * `allowOffHoursOverride` is explicitly true.
 *
 * Idempotent: if a pending/processing or finished snapshot already exists for the
 * same business + search term + grid + spacing, returns that scan without creating
 * a new LBM job (avoids duplicate credit spend). Finished scans are not rerun.
 */
export async function startMapRankScan(input: {
  businessId: string;
  businessName: string;
  googlePlaceId: string;
  latitude: number;
  longitude: number;
  searchTerm: string;
  gridSize: number;
  spacingValue: number;
  spacingUnit: "miles" | "meters";
  /** Force a new LBM scan even if one already exists for these settings. */
  force?: boolean;
  /**
   * Explicit internal override to bypass the local-hours window.
   * Must be true AND never silent — omitted/false always enforces the rule.
   */
  allowOffHoursOverride?: boolean;
  /** Optional clock injection for tests. */
  now?: Date;
}): Promise<{
  creditsEstimated: number;
  providerScanId: string | null;
  snapshotId: string | null;
  status:
    | "pending"
    | "finished"
    | "processing"
    | "waiting_for_window"
    | "timezone_missing";
  created: boolean;
  reused: boolean;
  deferred: boolean;
  schedule: {
    timeZone: string | null;
    localTime: string | null;
    nextEligibleAt: string | null;
    scheduleStatus: MapScanScheduleStatus;
    waitReason: string | null;
    scheduleRuleVersion: string;
    overrideUsed: boolean;
  };
}> {
  const creditsEstimated = input.gridSize * input.gridSize;
  const now = input.now ?? new Date();
  const scheduleRuleVersion = MAP_SCAN_SCHEDULE_RULE_VERSION;

  const db = await connectAdminPg();
  try {
    // Idempotent reuse / do not rerun completed scans
    if (!input.force) {
      const { rows } = await db.query<{
        id: string;
        provider_scan_id: string;
        status: string | null;
      }>(
        `select id, provider_scan_id, status
         from public.map_rank_snapshots
         where business_id = $1
           and provider = 'local_brand_manager'
           and search_term = $2
           and grid_size = $3
           and spacing_value = $4
           and coalesce(spacing_unit, 'miles') = $5
           and status in ('pending', 'processing', 'finished')
         order by
           case status
             when 'pending' then 0
             when 'processing' then 1
             when 'finished' then 2
             else 3
           end,
           coalesce(scanned_at, created_at) desc
         limit 1`,
        [
          input.businessId,
          input.searchTerm,
          input.gridSize,
          input.spacingValue,
          input.spacingUnit,
        ],
      );

      if (rows[0]) {
        const reuseStatus =
          (rows[0].status as "pending" | "processing" | "finished") ??
          "pending";
        const scheduleStatus: MapScanScheduleStatus =
          reuseStatus === "finished"
            ? "finished"
            : reuseStatus === "processing"
              ? "pending"
              : "pending";
        await updateBusinessMapScanSchedule(db, input.businessId, {
          timezone: null,
          status: scheduleStatus,
          nextEligibleAt: null,
          localTime: null,
          waitReason: null,
        });
        return {
          creditsEstimated:
            rows[0].status === "finished" ? 0 : creditsEstimated,
          providerScanId: rows[0].provider_scan_id,
          snapshotId: rows[0].id,
          status: reuseStatus,
          created: false,
          reused: true,
          deferred: false,
          schedule: {
            timeZone: null,
            localTime: null,
            nextEligibleAt: null,
            scheduleStatus,
            waitReason: null,
            scheduleRuleVersion,
            overrideUsed: false,
          },
        };
      }
    }

    const { rows: bizRows } = await db.query<{
      timezone: string | null;
      map_scan_timezone: string | null;
      market_id: string | null;
    }>(
      `select timezone, map_scan_timezone, market_id
       from public.businesses
       where id = $1`,
      [input.businessId],
    );
    const biz = bizRows[0];
    if (!biz) {
      throw new Error(`Business ${input.businessId} not found`);
    }

    let marketTimezone: string | null = null;
    if (biz.market_id) {
      const { rows: marketRows } = await db.query<{ timezone: string }>(
        `select timezone from public.markets where id = $1`,
        [biz.market_id],
      );
      marketTimezone = marketRows[0]?.timezone ?? null;
      if (!marketTimezone) {
        const codeMarket = MARKETS[biz.market_id as keyof typeof MARKETS];
        marketTimezone = codeMarket?.timezone ?? null;
      }
    }

    const resolved = resolveMapScanTimezone({
      businessTimezone: biz.map_scan_timezone || biz.timezone,
      marketTimezone,
    });

    if (!resolved.timeZone) {
      await updateBusinessMapScanSchedule(db, input.businessId, {
        timezone: null,
        status: "timezone_missing",
        nextEligibleAt: null,
        localTime: null,
        waitReason:
          "Missing business and market timezone — scan not created; flagged for manual review",
      });
      return {
        creditsEstimated: 0,
        providerScanId: null,
        snapshotId: null,
        status: "timezone_missing",
        created: false,
        reused: false,
        deferred: true,
        schedule: {
          timeZone: null,
          localTime: null,
          nextEligibleAt: null,
          scheduleStatus: "timezone_missing",
          waitReason:
            "Missing business and market timezone — scan not created; flagged for manual review",
          scheduleRuleVersion,
          overrideUsed: false,
        },
      };
    }

    const windowEval = evaluateMapScanWindow(now, resolved.timeZone);
    const overrideUsed = input.allowOffHoursOverride === true;

    if (!windowEval.eligible && !overrideUsed) {
      await updateBusinessMapScanSchedule(db, input.businessId, {
        timezone: resolved.timeZone,
        status: "waiting_for_window",
        nextEligibleAt: windowEval.nextEligibleAt,
        localTime: windowEval.requestedAtLocal,
        waitReason: windowEval.waitReason,
      });
      return {
        creditsEstimated: 0,
        providerScanId: null,
        snapshotId: null,
        status: "waiting_for_window",
        created: false,
        reused: false,
        deferred: true,
        schedule: {
          timeZone: resolved.timeZone,
          localTime: windowEval.requestedAtLocal,
          nextEligibleAt: windowEval.nextEligibleAt.toISOString(),
          scheduleStatus: "waiting_for_window",
          waitReason: windowEval.waitReason,
          scheduleRuleVersion,
          overrideUsed: false,
        },
      };
    }

    const created = await createLbmGeogrid({
      businessName: input.businessName,
      googlePlaceId: input.googlePlaceId,
      latitude: input.latitude,
      longitude: input.longitude,
      searchTerm: input.searchTerm,
      gridSize: input.gridSize,
      gridPointDistance: input.spacingValue,
      gridDistanceMeasure: input.spacingUnit,
      local: true,
    });

    const snapshotId = await insertPendingMapRankSnapshot({
      businessId: input.businessId,
      businessPlaceId: input.googlePlaceId,
      providerScanId: created.id,
      searchTerm: input.searchTerm,
      gridSize: input.gridSize,
      spacingValue: input.spacingValue,
      spacingUnit: input.spacingUnit,
      locationTimezone: resolved.timeZone,
      requestedAtUtc: now,
      requestedAtLocal: windowEval.requestedAtLocal,
      localWeekday: windowEval.localWeekday,
      localHour: windowEval.localHour,
      scheduleRuleVersion,
      client: db,
    });

    await updateBusinessMapScanSchedule(db, input.businessId, {
      timezone: resolved.timeZone,
      status: "submitted",
      nextEligibleAt: null,
      localTime: windowEval.requestedAtLocal,
      waitReason: overrideUsed
        ? "Submitted with explicit allowOffHoursOverride"
        : null,
      lastRequestedAt: now,
    });

    // Reflect pending shortly after submit
    await db.query(
      `update public.businesses
       set map_scan_schedule_status = 'pending'
       where id = $1`,
      [input.businessId],
    );

    return {
      creditsEstimated,
      providerScanId: created.id,
      snapshotId,
      status: "pending",
      created: true,
      reused: false,
      deferred: false,
      schedule: {
        timeZone: resolved.timeZone,
        localTime: windowEval.requestedAtLocal,
        nextEligibleAt: null,
        scheduleStatus: "pending",
        waitReason: overrideUsed
          ? "Submitted with explicit allowOffHoursOverride"
          : null,
        scheduleRuleVersion,
        overrideUsed,
      },
    };
  } finally {
    await db.end();
  }
}

/**
 * One-shot LBM status check. Never polls.
 * - pending/processing → report and exit (no DB update beyond optional status sync)
 * - finished → store results in map_rank_snapshots
 * - error/failed → store error
 */
export async function checkLbmGeogridOnce(
  providerScanId: string,
): Promise<{
  providerScanId: string;
  lbmState: string | null;
  action: "pending" | "stored" | "failed";
  snapshot: MapRankSnapshotRow | null;
  message: string;
}> {
  const db = await connectAdminPg();
  try {
    const { rows: existing } = await db.query<{
      business_id: string;
      business_place_id: string;
      status: string | null;
    }>(
      `select business_id, business_place_id, status
       from public.map_rank_snapshots
       where provider = 'local_brand_manager'
         and provider_scan_id = $1`,
      [providerScanId],
    );

    if (!existing[0]) {
      throw new Error(
        `No map_rank_snapshots row for provider_scan_id=${providerScanId}`,
      );
    }

    const placeId = existing[0].business_place_id;
    const businessId = existing[0].business_id;
    const payload = await fetchLbmGeogrid(providerScanId);
    const lbmState = payload.state ?? null;

    if (lbmState === "finished") {
      const snapshot = await completeMapRankSnapshot({
        providerScanId,
        businessPlaceId: placeId,
        payload,
        client: db,
      });
      await updateBusinessMapScanSchedule(db, businessId, {
        timezone: null,
        status: "finished",
        nextEligibleAt: null,
        localTime: null,
        waitReason: null,
      });
      return {
        providerScanId,
        lbmState,
        action: "stored",
        snapshot,
        message: "Scan complete — results stored in map_rank_snapshots",
      };
    }

    if (lbmState === "error" || lbmState === "failed") {
      await markMapRankSnapshotFailed({
        providerScanId,
        errorMessage: `LBM geogrid state=${lbmState}`,
        raw: payload,
        client: db,
      });
      await updateBusinessMapScanSchedule(db, businessId, {
        timezone: null,
        status: "failed",
        nextEligibleAt: null,
        localTime: null,
        waitReason: `LBM geogrid state=${lbmState}`,
      });
      return {
        providerScanId,
        lbmState,
        action: "failed",
        snapshot: null,
        message: `Scan failed with LBM state=${lbmState}`,
      };
    }

    // Still pending/processing — leave pending row as-is (or sync status text)
    if (lbmState && lbmState !== existing[0].status) {
      await db.query(
        `update public.map_rank_snapshots
         set status = $2
         where provider = 'local_brand_manager'
           and provider_scan_id = $1
           and status in ('pending', 'processing')`,
        [providerScanId, lbmState],
      );
    }

    return {
      providerScanId,
      lbmState,
      action: "pending",
      snapshot: null,
      message: `Scan still ${lbmState ?? "pending"} — run check again later`,
    };
  } finally {
    await db.end();
  }
}

/** @deprecated Use startMapRankScan + checkLbmGeogridOnce (no long polling). */
export async function runAndStoreMapRankScan(input: {
  businessId: string;
  businessName: string;
  googlePlaceId: string;
  latitude: number;
  longitude: number;
  searchTerm: string;
  gridSize: number;
  spacingValue: number;
  spacingUnit: "miles" | "meters";
}): Promise<{
  creditsEstimated: number;
  providerScanId: string | null;
  snapshotId: string | null;
  status:
    | "pending"
    | "finished"
    | "processing"
    | "waiting_for_window"
    | "timezone_missing";
  created: boolean;
  reused: boolean;
  deferred: boolean;
  schedule: {
    timeZone: string | null;
    localTime: string | null;
    nextEligibleAt: string | null;
    scheduleStatus: MapScanScheduleStatus;
    waitReason: string | null;
    scheduleRuleVersion: string;
    overrideUsed: boolean;
  };
}> {
  return startMapRankScan(input);
}

export async function getLatestMapRankSnapshotForBusiness(
  businessId: string,
  client?: Client,
): Promise<MapRankSnapshotRow | null> {
  const owns = !client;
  const db = client ?? (await connectAdminPg());
  try {
    const { rows } = await db.query<{
      id: string;
      business_id: string;
      provider: string;
      provider_scan_id: string;
      business_place_id: string;
      search_term: string;
      scanned_at: string | null;
      grid_size: number | null;
      spacing_value: string | null;
      spacing_unit: string | null;
      average_grid_rank: string | null;
      average_total_grid_rank: string | null;
      share_of_local_voice: string | null;
      found_in_top_3_count: number | null;
      found_in_top_10_count: number | null;
      total_grid_points: number | null;
      ranks: unknown;
      competitors: unknown;
      status: string | null;
      raw_response: { error?: string } | null;
    }>(
      `select *
       from public.map_rank_snapshots
       where business_id = $1
       order by coalesce(scanned_at, created_at) desc
       limit 1`,
      [businessId],
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      id: r.id,
      businessId: r.business_id,
      provider: r.provider,
      providerScanId: r.provider_scan_id,
      businessPlaceId: r.business_place_id,
      searchTerm: r.search_term,
      scannedAt: r.scanned_at,
      gridSize: r.grid_size,
      spacingValue: r.spacing_value === null ? null : Number(r.spacing_value),
      spacingUnit: r.spacing_unit,
      averageGridRank:
        r.average_grid_rank === null ? null : Number(r.average_grid_rank),
      averageTotalGridRank:
        r.average_total_grid_rank === null
          ? null
          : Number(r.average_total_grid_rank),
      shareOfLocalVoice:
        r.share_of_local_voice === null
          ? null
          : Number(r.share_of_local_voice),
      foundInTop3Count: r.found_in_top_3_count,
      foundInTop10Count: r.found_in_top_10_count,
      totalGridPoints: r.total_grid_points,
      ranks: r.ranks,
      competitors: r.competitors,
      status: r.status,
      errorMessage:
        r.status === "failed"
          ? (r.raw_response?.error ?? "Scan failed")
          : null,
    };
  } finally {
    if (owns) await db.end();
  }
}
