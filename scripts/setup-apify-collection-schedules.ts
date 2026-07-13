/**
 * Separate discovery from monitoring on Apify:
 * - Disable weekly broad-search schedule (monitoring is Vercel Cron → Place IDs)
 * - Create/update quarterly market-discovery Task + Schedule + webhook (?mode=discovery)
 *
 * Usage: tsx scripts/setup-apify-collection-schedules.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { getMarket, marketLocationQueries } from "../src/lib/markets";

config({ path: ".env.local" });

const ACTOR_ID = "compass~crawler-google-places";

const WEEKLY_DISCOVERY_TASK = "boise-roofing-weekly";
const WEEKLY_DISCOVERY_SCHEDULE = "boise-roofing-weekly";

const QUARTERLY_TASK = "boise-roofing-quarterly-discovery";
const QUARTERLY_SCHEDULE = "boise-roofing-quarterly-discovery";
const QUARTERLY_WEBHOOK_DESC =
  "Vezzt import on Boise roofing quarterly discovery success";

/** Broad Boise Metro discovery — city locations × roofing contractor terms. */
function discoveryTaskInput() {
  const market = getMarket("boise-metro");
  // Actor accepts one locationQuery; prefer metro hub. Full city×term matrix
  // remains available via scripts/scrape-market-apify.ts for deeper passes.
  return {
    searchStringsArray: market.roofingSearchTerms,
    locationQuery: "Boise, Idaho, USA",
    maxCrawledPlacesPerSearch: 50,
    language: "en",
    skipClosedPlaces: false,
    scrapePlaceDetailPage: true,
    maxReviews: 0,
    maxImages: 0,
    includeWebResults: false,
    marketCities: market.cities,
    marketLocationQueries: marketLocationQueries(market),
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

  // Strip non-actor helper metadata before putting input
  const { marketCities, marketLocationQueries, ...actorInput } = input as {
    marketCities?: string[];
    marketLocationQueries?: string[];
    [k: string]: unknown;
  };
  void marketCities;
  void marketLocationQueries;

  await apify(`/actor-tasks/${task.id}/input`, {
    method: "PUT",
    body: JSON.stringify(actorInput),
  });

  return task;
}

async function main() {
  const secret = webhookSecret();
  const discoveryUrl = discoveryWebhookUrl();
  const input = discoveryTaskInput();

  // --- Disable old weekly broad-search schedule ---
  const oldSchedule = await findScheduleByName(WEEKLY_DISCOVERY_SCHEDULE);
  let weeklyDisabled: Record<string, unknown> | null = null;
  if (oldSchedule) {
    const detail = await apify<{
      data: {
        id: string;
        name: string;
        isEnabled: boolean;
        cronExpression: string;
        timezone: string;
        actions?: unknown[];
        title?: string;
        description?: string;
        isExclusive?: boolean;
      };
    }>(`/schedules/${oldSchedule.id}`);

    await apify(`/schedules/${oldSchedule.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: detail.data.name,
        title: detail.data.title ?? WEEKLY_DISCOVERY_SCHEDULE,
        isEnabled: false,
        isExclusive: detail.data.isExclusive ?? true,
        cronExpression: detail.data.cronExpression,
        timezone: detail.data.timezone,
        description:
          "DISABLED — broad search moved to quarterly discovery; weekly monitoring is Vercel Cron Place-ID refresh.",
        actions: detail.data.actions ?? [],
      }),
    });
    weeklyDisabled = {
      scheduleId: oldSchedule.id,
      name: WEEKLY_DISCOVERY_SCHEDULE,
      isEnabled: false,
    };
    console.log(`Disabled weekly discovery schedule ${oldSchedule.id}`);
  }

  // Rename old weekly task title for clarity (keep for history)
  const oldTask = await findTaskByName(WEEKLY_DISCOVERY_TASK);
  if (oldTask) {
    await apify(`/actor-tasks/${oldTask.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: WEEKLY_DISCOVERY_TASK,
        title: "Boise Roofing (deprecated weekly discovery)",
        options: { build: "latest" },
      }),
    });
  }

  // --- Quarterly discovery Task ---
  const task = await ensureTask(
    QUARTERLY_TASK,
    "Boise Roofing Quarterly Discovery",
    input,
  );
  console.log(`Quarterly discovery task ${task.id}`);

  // First day of Jan/Apr/Jul/Oct at 09:00 America/Boise
  const cronExpression = "0 9 1 1,4,7,10 *";
  const timezone = "America/Boise";

  let schedule = await findScheduleByName(QUARTERLY_SCHEDULE);
  const scheduleBody = {
    name: QUARTERLY_SCHEDULE,
    title: "Boise Roofing Quarterly Discovery",
    isEnabled: true,
    isExclusive: true,
    cronExpression,
    timezone,
    description:
      "Quarterly Boise Metro roofing discovery — find new Place IDs / category changes; webhook imports with mode=discovery.",
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
      name: QUARTERLY_SCHEDULE,
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

  let webhook = await findWebhook(task.id, QUARTERLY_WEBHOOK_DESC);
  const webhookBody = {
    isEnabled: true,
    eventTypes: ["ACTOR.RUN.SUCCEEDED"],
    condition: { actorTaskId: task.id },
    requestUrl: discoveryUrl,
    headersTemplate: JSON.stringify({
      "Content-Type": "application/json",
      "x-apify-webhook-secret": secret,
    }),
    description: QUARTERLY_WEBHOOK_DESC,
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
      description: QUARTERLY_WEBHOOK_DESC,
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
      quarterlyDiscovery:
        "Apify Schedule → quarterly Task → webhook ?mode=discovery",
      uniqueness: "google_place_id / placeId UNIQUE + ON CONFLICT",
      qualification: 'primary categoryName === "Roofing contractor"',
    },
    weeklyDiscoveryDisabled: weeklyDisabled,
    deprecatedWeeklyTaskId: oldTask?.id ?? null,
    quarterlyTaskId: task.id,
    quarterlyTaskConsoleUrl: `https://console.apify.com/actors/tasks/${task.id}`,
    quarterlyScheduleId: scheduleDetail.data.id,
    quarterlyScheduleConsoleUrl: `https://console.apify.com/schedules/${scheduleDetail.data.id}`,
    cronExpression,
    timezone,
    isEnabled: scheduleDetail.data.isEnabled,
    nextRunAt: scheduleDetail.data.nextRunAt,
    webhookId: webhook!.id,
    webhookUrl: discoveryUrl,
    apifyWebhookSecret: secret,
    notes: [
      "Weekly/monthly monitoring must NOT use broad searchStringsArray terms.",
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
