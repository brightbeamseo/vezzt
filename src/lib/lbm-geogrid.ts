import type { Client } from "pg";
import { connectAdminPg } from "@/lib/admin-db";

export type LbmGeogridCompetitor = {
  name?: string | null;
  place_id?: string | null;
  rating?: number | null;
  reviews_count?: number | null;
  your_company?: boolean | null;
  address?: string | null;
  categories?: string[] | null;
  maps_url?: string | null;
  geogrid?: {
    solv?: number | null;
    agr?: number | null;
    atgr?: number | null;
    ranks?: unknown;
  } | null;
};

export type LbmGeogridPayload = {
  id: string;
  state?: string | null;
  business_name?: string | null;
  business_place_id?: string | null;
  search_term?: string | null;
  grid_size?: number | null;
  grid_point_distance?: number | null;
  grid_distance_measure?: string | null;
  local?: boolean | null;
  grid_center_lat?: number | null;
  grid_center_lng?: number | null;
  solv?: number | null;
  agr?: number | null;
  atgr?: number | null;
  ranks?: unknown;
  competitors?: LbmGeogridCompetitor[] | null;
  created_at?: string | null;
  finished_at?: string | null;
};

export type GeogridSnapshotInsert = {
  businessId: string;
  googlePlaceId: string;
  lbmGeogridId: string;
  searchTerm: string;
  gridSize: number | null;
  gridPointDistance: number | null;
  gridDistanceMeasure: string | null;
  localPack: boolean | null;
  gridCenterLat: number | null;
  gridCenterLng: number | null;
  snapshotAt: string;
  state: string | null;
  solv: number | null;
  agr: number | null;
  atgr: number | null;
  ranks: unknown;
  gridRanks: unknown;
  competitors: LbmGeogridCompetitor[];
  competitorCount: number;
  raw: LbmGeogridPayload;
};

function lbmToken(): string {
  // Prefer raw .env.local locally to avoid agent secret overlays.
  if (!process.env.VERCEL) {
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
      if (raw.LOCAL_BRAND_MANAGER_API_TOKEN) {
        return raw.LOCAL_BRAND_MANAGER_API_TOKEN;
      }
    } catch {
      // fall through
    }
  }
  const token = process.env.LOCAL_BRAND_MANAGER_API_TOKEN || "";
  if (!token) throw new Error("Missing LOCAL_BRAND_MANAGER_API_TOKEN");
  return token;
}

const LBM_BASE = "https://api.localbrandmanager.com";

async function lbmFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${LBM_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Token ${lbmToken()}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  let body: T;
  try {
    body = text ? (JSON.parse(text) as T) : (null as T);
  } catch {
    throw new Error(`LBM ${path} non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  return { status: res.status, body };
}

/**
 * Find subject metrics by google_place_id — never by business name.
 */
export function extractSubjectMetrics(
  payload: LbmGeogridPayload,
  googlePlaceId: string,
): {
  solv: number | null;
  agr: number | null;
  atgr: number | null;
  ranks: unknown;
  subject: LbmGeogridCompetitor | null;
} {
  const competitors = payload.competitors ?? [];
  const subject =
    competitors.find((c) => c.place_id === googlePlaceId) ??
    competitors.find((c) => c.your_company === true) ??
    null;

  const g = subject?.geogrid;
  return {
    solv: g?.solv ?? payload.solv ?? null,
    agr: g?.agr ?? payload.agr ?? null,
    atgr: g?.atgr ?? payload.atgr ?? null,
    ranks: g?.ranks ?? payload.ranks ?? null,
    subject,
  };
}

export async function fetchLbmGeogrid(
  lbmGeogridId: string,
): Promise<LbmGeogridPayload> {
  const { status, body } = await lbmFetch<LbmGeogridPayload>(
    `/geogrids/${lbmGeogridId}`,
  );
  if (status !== 200) {
    throw new Error(`GET /geogrids/${lbmGeogridId} → ${status}`);
  }
  return body;
}

export async function createLbmGeogrid(input: {
  businessName: string;
  googlePlaceId: string;
  latitude: number;
  longitude: number;
  searchTerm: string;
  gridSize?: number;
  gridPointDistance?: number;
  gridDistanceMeasure?: "miles" | "meters";
  local?: boolean;
}): Promise<{ id: string }> {
  const { status, body } = await lbmFetch<{ id?: string; errors?: unknown }>(
    "/geogrids",
    {
      method: "POST",
      body: JSON.stringify({
        business_name: input.businessName,
        business_place_id: input.googlePlaceId,
        business_country: "US",
        grid_center_lat: input.latitude,
        grid_center_lng: input.longitude,
        grid_size: input.gridSize ?? 7,
        grid_point_distance: input.gridPointDistance ?? 2,
        grid_distance_measure: input.gridDistanceMeasure ?? "miles",
        local: input.local ?? true,
        search_term: input.searchTerm,
      }),
    },
  );
  if ((status !== 200 && status !== 201) || !body?.id) {
    throw new Error(
      `POST /geogrids → ${status} ${JSON.stringify(body).slice(0, 500)}`,
    );
  }
  return { id: body.id };
}

export async function waitForLbmGeogrid(
  lbmGeogridId: string,
  options?: { timeoutMs?: number; pollMs?: number },
): Promise<LbmGeogridPayload> {
  const timeoutMs = options?.timeoutMs ?? 20 * 60 * 1000;
  const pollMs = options?.pollMs ?? 10_000;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const payload = await fetchLbmGeogrid(lbmGeogridId);
    if (payload.state === "finished" || payload.state === "error") {
      return payload;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timed out waiting for LBM geogrid ${lbmGeogridId}`);
}

export function buildGeogridSnapshotInsert(
  businessId: string,
  googlePlaceId: string,
  payload: LbmGeogridPayload,
): GeogridSnapshotInsert {
  if (payload.business_place_id && payload.business_place_id !== googlePlaceId) {
    throw new Error(
      `Place ID mismatch: Vezzt=${googlePlaceId} LBM=${payload.business_place_id}`,
    );
  }

  const metrics = extractSubjectMetrics(payload, googlePlaceId);
  const competitors = payload.competitors ?? [];
  const snapshotAt =
    payload.finished_at ||
    payload.created_at ||
    new Date().toISOString();

  return {
    businessId,
    googlePlaceId,
    lbmGeogridId: payload.id,
    searchTerm: payload.search_term || "",
    gridSize: payload.grid_size ?? null,
    gridPointDistance: payload.grid_point_distance ?? null,
    gridDistanceMeasure: payload.grid_distance_measure ?? null,
    localPack: payload.local ?? null,
    gridCenterLat: payload.grid_center_lat ?? null,
    gridCenterLng: payload.grid_center_lng ?? null,
    snapshotAt,
    state: payload.state ?? null,
    solv: metrics.solv,
    agr: metrics.agr,
    atgr: metrics.atgr,
    ranks: metrics.ranks,
    gridRanks: payload.ranks ?? null,
    competitors,
    competitorCount: competitors.length,
    raw: payload,
  };
}

export async function storeGeogridSnapshot(
  insert: GeogridSnapshotInsert,
  client?: Client,
): Promise<{ id: string; created: boolean }> {
  const owns = !client;
  const db = client ?? (await connectAdminPg());

  try {
    const { rows } = await db.query<{ id: string; inserted: boolean }>(
      `insert into public.geogrid_snapshots (
        business_id, google_place_id, lbm_geogrid_id, search_term,
        grid_size, grid_point_distance, grid_distance_measure, local_pack,
        grid_center_lat, grid_center_lng, snapshot_at, state,
        solv, agr, atgr, ranks, grid_ranks, competitors, competitor_count,
        source, raw
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::timestamptz,$12,
        $13,$14,$15,$16::jsonb,$17::jsonb,$18::jsonb,$19,
        'local_brand_manager',$20::jsonb
      )
      on conflict (lbm_geogrid_id) do update set
        solv = excluded.solv,
        agr = excluded.agr,
        atgr = excluded.atgr,
        ranks = excluded.ranks,
        grid_ranks = excluded.grid_ranks,
        competitors = excluded.competitors,
        competitor_count = excluded.competitor_count,
        state = excluded.state,
        snapshot_at = excluded.snapshot_at,
        raw = excluded.raw
      returning id, (xmax = 0) as inserted`,
      [
        insert.businessId,
        insert.googlePlaceId,
        insert.lbmGeogridId,
        insert.searchTerm,
        insert.gridSize,
        insert.gridPointDistance,
        insert.gridDistanceMeasure,
        insert.localPack,
        insert.gridCenterLat,
        insert.gridCenterLng,
        insert.snapshotAt,
        insert.state,
        insert.solv,
        insert.agr,
        insert.atgr,
        JSON.stringify(insert.ranks),
        JSON.stringify(insert.gridRanks),
        JSON.stringify(insert.competitors),
        insert.competitorCount,
        JSON.stringify(insert.raw),
      ],
    );

    return { id: rows[0].id, created: rows[0].inserted };
  } finally {
    if (owns) await db.end();
  }
}

/**
 * Resolve Vezzt business by google_place_id, then persist an LBM GeoGrid payload.
 */
export async function storeGeogridForPlaceId(
  googlePlaceId: string,
  payload: LbmGeogridPayload,
  client?: Client,
): Promise<{
  businessId: string;
  snapshotId: string;
  created: boolean;
  solv: number | null;
  agr: number | null;
  atgr: number | null;
}> {
  const owns = !client;
  const db = client ?? (await connectAdminPg());

  try {
    const { rows } = await db.query<{ id: string; google_place_id: string }>(
      `select id, google_place_id from public.businesses where google_place_id = $1`,
      [googlePlaceId],
    );
    if (!rows[0]) {
      throw new Error(`No Vezzt business for google_place_id=${googlePlaceId}`);
    }

    const insert = buildGeogridSnapshotInsert(
      rows[0].id,
      rows[0].google_place_id,
      payload,
    );
    const stored = await storeGeogridSnapshot(insert, db);
    return {
      businessId: rows[0].id,
      snapshotId: stored.id,
      created: stored.created,
      solv: insert.solv,
      agr: insert.agr,
      atgr: insert.atgr,
    };
  } finally {
    if (owns) await db.end();
  }
}
