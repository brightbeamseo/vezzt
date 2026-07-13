/**
 * Create Apify Task + weekly Schedule + success webhook for Boise roofing.
 * Idempotent-ish: reuses existing task/schedule by name when found.
 *
 * Usage: tsx scripts/setup-apify-weekly-schedule.ts
 */
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { getMarket } from "../src/lib/markets";

config({ path: ".env.local" });

const ACTOR_ID = "compass~crawler-google-places";
const TASK_NAME = "boise-roofing-weekly";
const SCHEDULE_NAME = "boise-roofing-weekly";
const WEBHOOK_DESC = "Vezzt import on Boise roofing weekly success";

/** Matches successful discovery pattern: multi-term roofing, detail page, no enrichments. */
function taskInput() {
  const market = getMarket("boise-metro");
  return {
    searchStringsArray: market.roofingSearchTerms,
    locationQuery: "Boise, Idaho, USA",
    maxCrawledPlacesPerSearch: 20,
    language: "en",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: true,
    maxReviews: 0,
    maxImages: 0,
  };
}

function token(): string {
  // Prefer raw .env.local to avoid agent secret-injection overlays.
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

function webhookUrl(secret: string): string {
  const base =
    process.env.VEZZT_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://vezzt.vercel.app";
  return `${base.replace(/\/$/, "")}/api/apify/run-complete`;
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
  const json = await apify<{ data: { items: { id: string; name: string; actId: string }[] } }>(
    `/actor-tasks?limit=100`,
  );
  return json.data.items.find((t) => t.name === name) ?? null;
}

async function findScheduleByName(name: string) {
  const json = await apify<{
    data: { items: { id: string; name: string; nextRunAt: string | null }[] };
  }>(`/schedules?limit=100`);
  return json.data.items.find((s) => s.name === name) ?? null;
}

async function findWebhook(actorTaskId: string) {
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
        w.description === WEBHOOK_DESC,
    ) ?? null
  );
}

async function main() {
  const secret = webhookSecret();
  const url = webhookUrl(secret);
  const input = taskInput();

  // --- Task ---
  let task = await findTaskByName(TASK_NAME);
  if (task) {
    await apify(`/actor-tasks/${task.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: TASK_NAME,
        title: "Boise Roofing Weekly",
        options: { build: "latest" },
      }),
    });
    console.log(`Updated existing task ${task.id}`);
  } else {
    const created = await apify<{ data: { id: string; name: string; actId: string } }>(
      `/actor-tasks`,
      {
        method: "POST",
        body: JSON.stringify({
          actId: ACTOR_ID,
          name: TASK_NAME,
          title: "Boise Roofing Weekly",
          options: { build: "latest" },
          input,
        }),
      },
    );
    task = {
      id: created.data.id,
      name: created.data.name,
      actId: created.data.actId,
    };
    console.log(`Created task ${task.id}`);
  }

  // Put input explicitly (some APIs use separate endpoint)
  await apify(`/actor-tasks/${task.id}/input`, {
    method: "PUT",
    body: JSON.stringify(input),
  });

  // --- Schedule: Mondays 15:37 America/Boise (matches discovery pilot weekday/time) ---
  const cronExpression = "37 15 * * 1";
  const timezone = "America/Boise";

  let schedule = await findScheduleByName(SCHEDULE_NAME);
  const scheduleBody = {
    name: SCHEDULE_NAME,
    title: "Boise Roofing Weekly",
    isEnabled: true,
    isExclusive: true,
    cronExpression,
    timezone,
    description:
      "Weekly Boise roofing scrape via compass/crawler-google-places Task; webhook imports to Vezzt.",
    actions: [
      {
        type: "RUN_ACTOR_TASK",
        actorTaskId: task.id,
      },
    ],
  };

  if (schedule) {
    const updated = await apify<{
      data: { id: string; nextRunAt: string | null; cronExpression: string; timezone: string };
    }>(`/schedules/${schedule.id}`, {
      method: "PUT",
      body: JSON.stringify(scheduleBody),
    });
    schedule = {
      id: updated.data.id,
      name: SCHEDULE_NAME,
      nextRunAt: updated.data.nextRunAt,
    };
    console.log(`Updated schedule ${schedule.id}`);
  } else {
    const created = await apify<{
      data: { id: string; nextRunAt: string | null };
    }>(`/schedules`, {
      method: "POST",
      body: JSON.stringify(scheduleBody),
    });
    schedule = {
      id: created.data.id,
      name: SCHEDULE_NAME,
      nextRunAt: created.data.nextRunAt,
    };
    console.log(`Created schedule ${schedule.id}`);
  }

  // Refresh schedule details for nextRunAt
  const scheduleDetail = await apify<{
    data: {
      id: string;
      name: string;
      nextRunAt: string | null;
      cronExpression: string;
      timezone: string;
      isEnabled: boolean;
    };
  }>(`/schedules/${schedule.id}`);

  // --- Webhook ---
  let webhook = await findWebhook(task.id);
  const webhookBody = {
    isEnabled: true,
    eventTypes: ["ACTOR.RUN.SUCCEEDED"],
    condition: { actorTaskId: task.id },
    requestUrl: url,
    headersTemplate: JSON.stringify({
      "Content-Type": "application/json",
      "x-apify-webhook-secret": secret,
    }),
    description: WEBHOOK_DESC,
  };

  if (webhook) {
    await apify(`/webhooks/${webhook.id}`, {
      method: "PUT",
      body: JSON.stringify(webhookBody),
    });
    console.log(`Updated webhook ${webhook.id}`);
  } else {
    const created = await apify<{ data: { id: string } }>(`/webhooks`, {
      method: "POST",
      body: JSON.stringify(webhookBody),
    });
    webhook = {
      id: created.data.id,
      description: WEBHOOK_DESC,
      requestUrl: url,
      condition: { actorTaskId: task.id },
    };
    console.log(`Created webhook ${webhook.id}`);
  }

  const report = {
    taskId: task.id,
    taskName: TASK_NAME,
    taskConsoleUrl: `https://console.apify.com/actors/tasks/${task.id}`,
    scheduleId: scheduleDetail.data.id,
    scheduleName: SCHEDULE_NAME,
    scheduleConsoleUrl: `https://console.apify.com/schedules/${scheduleDetail.data.id}`,
    schedulesListUrl: "https://console.apify.com/schedules",
    cronExpression,
    timezone,
    isEnabled: scheduleDetail.data.isEnabled,
    nextRunAt: scheduleDetail.data.nextRunAt,
    nextRunAtLocalHint:
      scheduleDetail.data.nextRunAt != null
        ? `Instant UTC: ${scheduleDetail.data.nextRunAt} (cron ${cronExpression} in ${timezone})`
        : null,
    webhookId: webhook.id,
    webhookUrl: url,
    apifyWebhookSecret: secret,
    taskInput: input,
    notes: [
      "Schedule runs entirely on Apify — no local Cursor/IDE required.",
      "On SUCCEEDED, Apify POSTs to /api/apify/run-complete with x-apify-webhook-secret.",
      "Import upserts by placeId and inserts review_snapshots with source=google_apify (no overwrite on same date).",
      "Store APIFY_TOKEN and APIFY_WEBHOOK_SECRET on Vercel production.",
    ],
  };

  writeFileSync("tmp/apify-weekly-schedule-setup.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  console.log("\nIMPORTANT: Set APIFY_WEBHOOK_SECRET on Vercel to the value above if newly generated.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
