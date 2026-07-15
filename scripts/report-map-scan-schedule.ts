/**
 * Report LBM GeoGrid local-hours eligibility for Boise Metro businesses.
 * Does not start scans.
 *
 * Usage: npm run report:map-scan-schedule
 */
import { config } from "dotenv";
import { connectAdminPg } from "../src/lib/admin-db";
import {
  evaluateMapScanWindow,
  resolveMapScanTimezone,
} from "../src/lib/map-scan-schedule";
import { MARKETS } from "../src/lib/markets";

config({ path: ".env.local" });

async function main() {
  const now = new Date();
  const db = await connectAdminPg();
  try {
    const { rows } = await db.query<{
      id: string;
      name: string;
      market_id: string | null;
      timezone: string | null;
      map_scan_timezone: string | null;
      map_scan_schedule_status: string | null;
      map_scan_next_eligible_at: string | null;
      map_scan_wait_reason: string | null;
      market_timezone: string | null;
      has_finished_scan: boolean;
    }>(
      `select
         b.id,
         b.name,
         b.market_id,
         b.timezone,
         b.map_scan_timezone,
         b.map_scan_schedule_status,
         b.map_scan_next_eligible_at::text,
         b.map_scan_wait_reason,
         m.timezone as market_timezone,
         exists (
           select 1 from public.map_rank_snapshots mrs
           where mrs.business_id = b.id
             and mrs.status = 'finished'
         ) as has_finished_scan
       from public.businesses b
       left join public.markets m on m.id = b.market_id
       where m.market_slug = 'boise-metro'
          or b.qualification_status = 'qualified'
       order by b.name`,
    );

    const assigned: unknown[] = [];
    const missing: unknown[] = [];
    const eligible: unknown[] = [];
    const waiting: unknown[] = [];

    for (const row of rows) {
      const resolved = resolveMapScanTimezone({
        businessTimezone: row.map_scan_timezone || row.timezone,
        marketTimezone:
          row.market_timezone || MARKETS["boise-metro"]?.timezone || null,
      });

      if (!resolved.timeZone) {
        missing.push({
          businessId: row.id,
          name: row.name,
          marketId: row.market_id,
        });
        continue;
      }

      const evalResult = evaluateMapScanWindow(now, resolved.timeZone);
      assigned.push({
        businessId: row.id,
        name: row.name,
        timeZone: resolved.timeZone,
        source: resolved.source,
        hasFinishedScan: row.has_finished_scan,
      });

      if (row.has_finished_scan) continue;

      if (evalResult.eligible) {
        eligible.push({
          businessId: row.id,
          name: row.name,
          timeZone: resolved.timeZone,
          localTime: evalResult.requestedAtLocal,
        });
      } else {
        waiting.push({
          businessId: row.id,
          name: row.name,
          timeZone: resolved.timeZone,
          localTime: evalResult.requestedAtLocal,
          nextEligibleAt: evalResult.nextEligibleAt.toISOString(),
          waitReason: evalResult.waitReason,
          storedStatus: row.map_scan_schedule_status,
          storedNextEligibleAt: row.map_scan_next_eligible_at,
        });
      }
    }

    // Persist current eligibility onto businesses that have a timezone
    for (const row of rows) {
      const resolved = resolveMapScanTimezone({
        businessTimezone: row.map_scan_timezone || row.timezone,
        marketTimezone:
          row.market_timezone || MARKETS["boise-metro"]?.timezone || null,
      });
      if (!resolved.timeZone) {
        await db.query(
          `update public.businesses set
             map_scan_schedule_status = 'timezone_missing',
             map_scan_wait_reason = $2,
             updated_at = now()
           where id = $1
             and coalesce(map_scan_schedule_status, '') not in ('pending', 'submitted', 'finished')`,
          [
            row.id,
            "Missing business and market timezone — flagged for manual review",
          ],
        );
        continue;
      }

      const evalResult = evaluateMapScanWindow(now, resolved.timeZone);
      if (row.has_finished_scan) {
        await db.query(
          `update public.businesses set
             timezone = coalesce(timezone, $2),
             map_scan_timezone = coalesce(map_scan_timezone, $2),
             map_scan_schedule_status = 'finished',
             map_scan_local_time = $3,
             map_scan_wait_reason = null,
             map_scan_next_eligible_at = null,
             updated_at = now()
           where id = $1`,
          [row.id, resolved.timeZone, evalResult.requestedAtLocal],
        );
        continue;
      }

      await db.query(
        `update public.businesses set
           timezone = coalesce(timezone, $2),
           map_scan_timezone = coalesce(map_scan_timezone, $2),
           map_scan_schedule_status = $3,
           map_scan_local_time = $4,
           map_scan_next_eligible_at = $5,
           map_scan_wait_reason = $6,
           updated_at = now()
         where id = $1
           and coalesce(map_scan_schedule_status, '') not in ('pending', 'submitted')`,
        [
          row.id,
          resolved.timeZone,
          evalResult.status,
          evalResult.requestedAtLocal,
          evalResult.eligible
            ? null
            : evalResult.nextEligibleAt.toISOString(),
          evalResult.waitReason,
        ],
      );
    }

    console.log(
      JSON.stringify(
        {
          evaluatedAtUtc: now.toISOString(),
          rule: "Mon–Fri 10:00–16:00 local",
          businessesWithTimezone: assigned.length,
          businessesMissingTimezone: missing.length,
          currentlyEligibleToRun: eligible.length,
          waitingForWindow: waiting.length,
          missing,
          eligible,
          waiting,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
