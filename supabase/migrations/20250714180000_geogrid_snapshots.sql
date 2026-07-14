-- Local Brand Manager GeoGrid snapshots keyed to Vezzt businesses via google_place_id.

create table if not exists public.geogrid_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  google_place_id text not null,
  lbm_geogrid_id text not null,
  search_term text not null,
  grid_size integer,
  grid_point_distance numeric,
  grid_distance_measure text,
  local_pack boolean,
  grid_center_lat numeric,
  grid_center_lng numeric,
  snapshot_at timestamptz not null,
  state text,
  solv numeric,
  agr numeric,
  atgr numeric,
  -- Rank grid for the subject business (matched by google_place_id)
  ranks jsonb,
  -- Full grid ranks from the LBM response root
  grid_ranks jsonb,
  competitors jsonb not null default '[]'::jsonb,
  competitor_count integer not null default 0,
  source text not null default 'local_brand_manager',
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (lbm_geogrid_id),
  unique (business_id, lbm_geogrid_id)
);

create index if not exists geogrid_snapshots_business_id_snapshot_at_idx
  on public.geogrid_snapshots (business_id, snapshot_at desc);

create index if not exists geogrid_snapshots_google_place_id_idx
  on public.geogrid_snapshots (google_place_id);

create index if not exists geogrid_snapshots_snapshot_at_idx
  on public.geogrid_snapshots (snapshot_at desc);

alter table public.geogrid_snapshots enable row level security;

create policy "anon_read_geogrid_snapshots"
  on public.geogrid_snapshots
  for select
  to anon, authenticated
  using (true);

comment on table public.geogrid_snapshots is
  'LBM GeoGrid results joined to Vezzt businesses by google_place_id / business_place_id.';
comment on column public.geogrid_snapshots.google_place_id is
  'Google Place ID — same value as businesses.google_place_id and LBM business_place_id.';
comment on column public.geogrid_snapshots.solv is
  'Share of Local Voice for the subject Place ID (your_company / matching place_id).';
comment on column public.geogrid_snapshots.agr is
  'Average Grid Rank for the subject Place ID.';
comment on column public.geogrid_snapshots.atgr is
  'Average Total Grid Rank for the subject Place ID.';
