-- Map rank snapshots (LBM GeoGrid) keyed to Vezzt businesses by Place ID.

create table if not exists public.map_rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null default 'local_brand_manager',
  provider_scan_id text not null,
  business_place_id text not null,
  search_term text not null,
  scanned_at timestamptz,
  grid_size integer,
  spacing_value numeric,
  spacing_unit text,
  average_grid_rank numeric,
  average_total_grid_rank numeric,
  share_of_local_voice numeric,
  found_in_top_3_count integer,
  found_in_top_10_count integer,
  total_grid_points integer,
  ranks jsonb,
  competitors jsonb,
  raw_response jsonb,
  status text,
  created_at timestamptz not null default now(),
  unique (provider, provider_scan_id)
);

create index if not exists map_rank_snapshots_business_id_scanned_at_idx
  on public.map_rank_snapshots (business_id, scanned_at desc nulls last);

create index if not exists map_rank_snapshots_business_place_id_idx
  on public.map_rank_snapshots (business_place_id);

alter table public.map_rank_snapshots enable row level security;

create policy "anon_read_map_rank_snapshots"
  on public.map_rank_snapshots
  for select
  to anon, authenticated
  using (true);

comment on table public.map_rank_snapshots is
  'GeoGrid / map-rank scans. Joined to businesses via business_place_id = google_place_id.';
comment on column public.map_rank_snapshots.business_place_id is
  'Google Place ID used for LBM business_place_id and Vezzt matching.';
