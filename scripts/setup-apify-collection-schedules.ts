/**
 * Separate discovery from monitoring on Apify:
 * - Keep weekly broad-search schedule disabled (monitoring is Vercel Cron → Place IDs)
 * - Replace quarterly locationQuery discovery with monthly map-centered startUrls
 *   (100 results × each Boise Metro city for "roofing contractor")
 *
 * Usage: tsx scripts/setup-apify-collection-schedules.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import {
  getMarket,
  MONTHLY_DISCOVERY_MAX_PER_CITY,
  monthlyDiscoveryStartUrls,
  PRIMARY_ROOFING_SEARCH_TERM,
} from "../src/lib/markets";

config({ path: ".env.local" });

const ACTOR_ID = "compass~crawler-google-places";

const WEEKLY_DISCOVERY_TASK = "boise-roofing-weekly";
const WEEKLY_DISCOVERY_SCHEDULE = "boise-roofing-weekly";

const QUARTERLY_TASK = "boise-roofing-quarterly-discovery";
const QUARTERLY_SCHEDULE = "boise-roofing-quarterly-discovery";

const MONTHLY_TASK = "boise-roofing-monthly-discovery";
const MONTHLY_SCHEDULE = "boise-roofing-monthly-discovery";
const MONTHLY_WEBHOOK_DESC =
  "Vezzt import on Boise roofing monthly discovery success";

/** Monthly Boise Metro discovery — map-centered Maps URLs, not locationQuery. */
function discoveryTaskInput() {
  const market = getMarket("boise-metro");
  return {
    startUrls: monthlyDiscoveryStartUrls(market, PRIMARY_ROOFING_SEARCH_TERM),
    maxCrawledPlacesPerSearch: MONTHLY_DISCOVERY_MAX_PER_CITY,
    language: "en",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: true,
    maxReviews: 0,
    maxImages: 0,
    includeWebResults: false,
    // Metadata stripped before writing actor input
    marketCities: market.cities,
    discoveryMethod: "maps_startUrls",
    searchTerm: PRIMARY_ROOFING_SEARCH_TERM,
  };
}

function token(): string {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
        }),
    ) as Record<string, string>;
    const fileToken = raw.APIFY_TOKEN || raw.APIFY_DEFAULT_API_TOKEN;
    if (fileToken) return fileToken;
  } catch {
    // fall through
  }
  const t =
    process.env.APIFY_TOKEN || process.env.APIFY_DEFAULT_API_TOKEN || "";
  if (!t) throw new Error("Missing APIFY_TOKEN / APIFY_DEFAULT_API_TOKEN");
  return t;
}

function webhookSecret(): string {
  try {
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const raw = Object.fromEntries(
      readFileSync(".env.local", "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i), l.slice(i + 1)];
        }),
    ) as Record<string, string>;
    if (raw.APIFY_WEBHOOK_SECRET) return raw.APIFY_WEBHOOK_SECRET;
  } catch {
    // fall through
  }
  if (process.env.APIFY_WEBHOOK_SECRET) return process.env.APIFY_WEBHOOK_SECRET;
  return randomBytes(24).toString("hex");
}

function discoveryWebhookUrl(): string {
  const base =
    process.env.VEZZT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://vezzt.vercel.app";
  return `${base.replace(/\/$/, "")}/api/apify/run-complete?mode=discovery`;
}

async function apify<T>(
  path: string,
  init?: RequestInit & { method?: string },
): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `https://api.apify.com/v2${path}${sep}token=${encodeURIComponent(token())}`,
    {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      `${init?.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function findTaskByName(name: string) {
  const json = await apify<{
    data: { items: { id: string; name: string; actId: string }[] };
  }>(`/actor-tasks?limit=100`);
  return json.data.items.find((t) => t.name === name) ?? null;
}

async function findScheduleByName(name: string) {
  const json = await apify<{
    data: { items: { id: string; name: string; nextRunAt: string | null }[] };
  }>(`/schedules?limit=100`);
  return json.data.items.find((s) => s.name === name) ?? null;
}

async function findWebhook(actorTaskId: string, description: string) {
  const json = await apify<{
    data: {
      items: {
        id: string;
        description?: string;
        requestUrl: string;
        condition: { actorTaskId?: string };
      }[];
    };
  }>(`/webhooks?limit=100`);
  return (
    json.data.items.find(
      (w) =>
        w.condition?.actorTaskId === actorTaskId ||
        w.description === description,
    ) ?? null
  );
}

async function ensureTask(name: string, title: string, input: object) {
  let task = await findTaskByName(name);
  if (task) {
    await apify(`/actor-tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name,
        title,
        options: { build: "latest" },
      }),
    });
  } else {
    const created = await apify<{
      data: { id: string; name: string; actId: string };
    }>(`/actor-tasks`, {
      method: "POST",
      body: JSON.stringify({
        actId: ACTOR_ID,
        name,
        title,
        options: { build: "latest" },
        input,
      }),
    });
    task = {
      id: created.data.id,
      name: created.data.name,
      actId: created.data.actId,
    };
  }

  const {
    marketCities,
    discoveryMethod,
    searchTerm,
    ...actorInput
  } = input as {
    marketCities?: string[];
    discoveryMethod?: string;
    searchTerm?: string;
    [k: string]: unknown;
  };
  void marketCities;
  void discoveryMethod;
  void searchTerm;

  await apify(`/actor-tasks/${task.id}/input`, {
    method: "PUT",
    body: JSON.stringify(actorInput),
  });

  return task;
}

async function disableSchedule(
  name: string,
  reason: string,
): Promise<Record<string, unknown> | null> {
  const schedule = await findScheduleByName(name);
  if (!schedule) return null;

  const detail = await apify<{
    data: {
      id: string;
      name: string;
      isEnabled: boolean;
      cronExpression: string;
      timezone: string;
      actions?: unknown[];
      title?: string;
      isExclusive?: boolean;
    };
  }>(`/schedules/${schedule.id}`);

  await apify(`/schedules/${schedule.id}`, {
    method: "PUT",
    body: JSON.stringify({
      name: detail.data.name,
      title: detail.data.title ?? name,
      isEnabled: false,
      isExclusive: detail.data.isExclusive ?? true,
      cronExpression: detail.data.cronExpression,
      timezone: detail.data.timezone,
      description: reason,
      actions: detail.data.actions ?? [],
    }),
  });

  return {
    scheduleId: schedule.id,
    name,
    isEnabled: false,
  };
}

async function main() {
  const secret = webhookSecret();
  const discoveryUrl = discoveryWebhookUrl();
  const input = discoveryTaskInput();
  const market = getMarket("boise-metro");

  // --- Disable old weekly + quarterly discovery schedules ---
  const weeklyDisabled = await disableSchedule(
    WEEKLY_DISCOVERY_SCHEDULE,
    "DISABLED — use monthly map-URL discovery; weekly monitoring is Vercel Cron Place-ID refresh.",
  );
  if (weeklyDisabled) {
    console.log(`Disabled weekly discovery schedule ${weeklyDisabled.scheduleId}`);
  }

  const quarterlyDisabled = await disableSchedule(
    QUARTERLY_SCHEDULE,
    "DISABLED — replaced by monthly map-centered startUrls discovery.",
  );
  if (quarterlyDisabled) {
    console.log(
      `Disabled quarterly discovery schedule ${quarterlyDisabled.scheduleId}`,
    );
  }

  const oldWeeklyTask = await findTaskByName(WEEKLY_DISCOVERY_TASK);
  if (oldWeeklyTask) {
    await apify(`/actor-tasks/${oldWeeklyTask.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: WEEKLY_DISCOVERY_TASK,
        title: "Boise Roofing (deprecated weekly discovery)",
        options: { build: "latest" },
      }),
    });
  }

  const oldQuarterlyTask = await findTaskByName(QUARTERLY_TASK);
  if (oldQuarterlyTask) {
    await apify(`/actor-tasks/${oldQuarterlyTask.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: QUARTERLY_TASK,
        title: "Boise Roofing (deprecated quarterly locationQuery discovery)",
        options: { build: "latest" },
      }),
    });
  }

  // --- Monthly map-centered discovery Task ---
  const task = await ensureTask(
    MONTHLY_TASK,
    "Boise Roofing Monthly Discovery (map URLs)",
    input,
  );
  console.log(`Monthly discovery task ${task.id}`);

  // 1st of each month at 09:00 America/Boise
  const cronExpression = "0 9 1 * *";
  const timezone = market.timezone;

  let schedule = await findScheduleByName(MONTHLY_SCHEDULE);
  const scheduleBody = {
    name: MONTHLY_SCHEDULE,
    title: "Boise Roofing Monthly Discovery",
    isEnabled: true,
    isExclusive: true,
    cronExpression,
    timezone,
    description:
      `Monthly Boise Metro roofing discovery via Maps startUrls (${PRIMARY_ROOFING_SEARCH_TERM}, ${MONTHLY_DISCOVERY_MAX_PER_CITY}/city). Webhook imports with mode=discovery.`,
    actions: [
      {
        type: "RUN_ACTOR_TASK",
        actorTaskId: task.id,
      },
    ],
  };

  if (schedule) {
    await apify(`/schedules/${schedule.id}`, {
      method: "PUT",
      body: JSON.stringify(scheduleBody),
    });
  } else {
    const created = await apify<{ data: { id: string } }>(`/schedules`, {
      method: "POST",
      body: JSON.stringify(scheduleBody),
    });
    schedule = {
      id: created.data.id,
      name: MONTHLY_SCHEDULE,
      nextRunAt: null,
    };
  }

  const scheduleDetail = await apify<{
    data: {
      id: string;
      name: string;
      nextRunAt: string | null;
      cronExpression: string;
      timezone: string;
      isEnabled: boolean;
    };
  }>(`/schedules/${schedule!.id}`);

  let webhook = await findWebhook(task.id, MONTHLY_WEBHOOK_DESC);
  const webhookBody = {
    isEnabled: true,
    eventTypes: ["ACTOR.RUN.SUCCEEDED"],
    condition: { actorTaskId: task.id },
    requestUrl: discoveryUrl,
    headersTemplate: JSON.stringify({
      "Content-Type": "application/json",
      "x-apify-webhook-secret": secret,
    }),
    description: MONTHLY_WEBHOOK_DESC,
  };

  if (webhook) {
    await apify(`/webhooks/${webhook.id}`, {
      method: "PUT",
      body: JSON.stringify(webhookBody),
    });
  } else {
    const created = await apify<{ data: { id: string } }>(`/webhooks`, {
      method: "POST",
      body: JSON.stringify(webhookBody),
    });
    webhook = {
      id: created.data.id,
      description: MONTHLY_WEBHOOK_DESC,
      requestUrl: discoveryUrl,
      condition: { actorTaskId: task.id },
    };
  }

  const report = {
    separation: {
      weeklyMonitoring:
        "Vercel Cron → /api/cron/weekly-roofing-monitor (Tier 1 Place IDs only)",
      monthlyMonitoring:
        "Vercel Cron → /api/cron/monthly-roofing-monitor (Tier 2 Place IDs only)",
      monthlyDiscovery:
        "Apify Schedule → monthly map startUrls Task → webhook ?mode=discovery",
      uniqueness: "google_place_id / placeId UNIQUE + ON CONFLICT",
      qualification: 'primary categoryName === "Roofing contractor"',
    },
    weeklyDiscoveryDisabled: weeklyDisabled,
    quarterlyDiscoveryDisabled: quarterlyDisabled,
    deprecatedWeeklyTaskId: oldWeeklyTask?.id ?? null,
    deprecatedQuarterlyTaskId: oldQuarterlyTask?.id ?? null,
    monthlyTaskId: task.id,
    monthlyTaskConsoleUrl: `https://console.apify.com/actors/tasks/${task.id}`,
    monthlyScheduleId: scheduleDetail.data.id,
    monthlyScheduleConsoleUrl: `https://console.apify.com/schedules/${scheduleDetail.data.id}`,
    cronExpression,
    timezone,
    isEnabled: scheduleDetail.data.isEnabled,
    nextRunAt: scheduleDetail.data.nextRunAt,
    webhookId: webhook!.id,
    webhookUrl: discoveryUrl,
    discoveryMethod: "maps_startUrls",
    searchTerm: PRIMARY_ROOFING_SEARCH_TERM,
    maxPerCity: MONTHLY_DISCOVERY_MAX_PER_CITY,
    cities: market.cities,
    startUrls: input.startUrls,
    apifyWebhookSecret: secret,
    notes: [
      "Discovery MUST use Google Maps search URLs with city lat/lng/zoom (startUrls).",
      "Do NOT use locationQuery city-name mode for discovery — it misses map-ranked listings.",
      "Monthly: 100 results × each market city for primary term roofing contractor.",
      "Weekly/monthly Place-ID monitoring must NOT use broad searchStringsArray terms.",
      "Monitor webhook uses ?mode=monitor and refuses to insert unknown placeIds.",
      "Discovery upserts by google_place_id; logs non-Roofing-contractor results.",
      "Set CRON_SECRET on Vercel for monitor crons (Authorization: Bearer).",
    ],
  };

  mkdirSync("tmp", { recursive: true });
  writeFileSync(
    "tmp/apify-collection-schedules.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
