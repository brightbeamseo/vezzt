-- Phase IIIB: LOA roofing GBP discovery storage + competition metrics.
-- No Opportunity Score. Raw discovery + physical competition baselines only.

-- ---------------------------------------------------------------------------
-- Global unique Place IDs discovered during expansion analysis
-- ---------------------------------------------------------------------------
create table if not exists public.loa_gbp_businesses (
  place_id text primary key,
  title text,
  category_name text,
  categories text[] not null default '{}',
  qualify_bucket text not null
    check (qualify_bucket in ('primary', 'secondary', 'other')),
  reviews_count integer,
  total_score numeric,
  address text,
  city text,
  state text,
  postal_code text,
  lat numeric,
  lng numeric,
  website text,
  phone text,
  permanently_closed boolean not null default false,
  temporarily_closed boolean not null default false,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loa_gbp_businesses_qualify_idx
  on public.loa_gbp_businesses (qualify_bucket);
create index if not exists loa_gbp_businesses_reviews_idx
  on public.loa_gbp_businesses (reviews_count desc nulls last);

alter table public.loa_gbp_businesses enable row level security;

drop policy if exists "anon_read_loa_gbp_businesses" on public.loa_gbp_businesses;
create policy "anon_read_loa_gbp_businesses"
  on public.loa_gbp_businesses for select to anon, authenticated using (true);

grant select on public.loa_gbp_businesses to anon, authenticated;

comment on table public.loa_gbp_businesses is
  'Globally unique Google Place IDs from LOA roofing GBP discovery (Phase IIIB).';

-- ---------------------------------------------------------------------------
-- One Apify run per LOA search point
-- ---------------------------------------------------------------------------
create table if not exists public.loa_gbp_search_runs (
  id uuid primary key default gen_random_uuid(),
  loa_id uuid not null references public.local_opportunity_areas(id) on delete cascade,
  search_point text not null
    check (search_point in ('center', 'north', 'east', 'south', 'west')),
  search_lat numeric not null,
  search_lng numeric not null,
  maps_url text not null,
  apify_run_id text not null unique,
  dataset_id text,
  status text not null,
  usage_usd numeric,
  raw_count integer,
  scraped_at timestamptz not null default now(),
  unique (loa_id, search_point)
);

create index if not exists loa_gbp_search_runs_loa_idx
  on public.loa_gbp_search_runs (loa_id);
create index if not exists loa_gbp_search_runs_status_idx
  on public.loa_gbp_search_runs (status);

alter table public.loa_gbp_search_runs enable row level security;

drop policy if exists "anon_read_loa_gbp_search_runs" on public.loa_gbp_search_runs;
create policy "anon_read_loa_gbp_search_runs"
  on public.loa_gbp_search_runs for select to anon, authenticated using (true);

grant select on public.loa_gbp_search_runs to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sightings: each Place ID surfaced from a search point within an LOA
-- ---------------------------------------------------------------------------
create table if not exists public.loa_gbp_sightings (
  id uuid primary key default gen_random_uuid(),
  loa_id uuid not null references public.local_opportunity_areas(id) on delete cascade,
  place_id text not null references public.loa_gbp_businesses(place_id) on delete cascade,
  search_point text not null
    check (search_point in ('center', 'north', 'east', 'south', 'west')),
  search_run_id uuid references public.loa_gbp_search_runs(id) on delete set null,
  rank_in_search integer,
  distance_miles numeric,
  in_radius boolean,
  scraped_at timestamptz not null default now(),
  unique (loa_id, place_id, search_point)
);

create index if not exists loa_gbp_sightings_loa_idx
  on public.loa_gbp_sightings (loa_id);
create index if not exists loa_gbp_sightings_place_idx
  on public.loa_gbp_sightings (place_id);
create index if not exists loa_gbp_sightings_in_radius_idx
  on public.loa_gbp_sightings (loa_id, in_radius)
  where in_radius = true;

alter table public.loa_gbp_sightings enable row level security;

drop policy if exists "anon_read_loa_gbp_sightings" on public.loa_gbp_sightings;
create policy "anon_read_loa_gbp_sightings"
  on public.loa_gbp_sightings for select to anon, authenticated using (true);

grant select on public.loa_gbp_sightings to anon, authenticated;

comment on table public.loa_gbp_sightings is
  'Preserves which LOA search points surfaced each GBP. Supports physical vs search competition.';

-- ---------------------------------------------------------------------------
-- Per-LOA competition rollups (no proprietary score)
-- ---------------------------------------------------------------------------
create table if not exists public.loa_roofing_competition (
  loa_id uuid primary key references public.local_opportunity_areas(id) on delete cascade,
  -- Discovery status
  gbp_discovery_status text not null default 'pending'
    check (gbp_discovery_status in ('pending', 'partial', 'complete', 'failed')),
  search_points_complete integer not null default 0,
  discovery_cost_usd numeric,
  raw_sightings integer,
  unique_place_ids integer,
  primary_count integer,
  secondary_count integer,
  other_count integer,
  -- Physical competition (primary, ≤15mi)
  primary_in_radius integer,
  roofers_per_100k_pop numeric,
  roofers_per_10k_owner_hh numeric,
  reviews_median numeric,
  reviews_avg numeric,
  reviews_max integer,
  reviews_50_plus integer,
  reviews_100_plus integer,
  reviews_250_plus integer,
  reviews_500_plus integer,
  reviews_1000_plus integer,
  top5_reviews_avg numeric,
  top5_reviews_median numeric,
  owner_hh_per_roofer numeric,
  owner_hh_per_50_plus numeric,
  owner_hh_per_100_plus numeric,
  owner_hh_per_250_plus numeric,
  owner_hh_per_500_plus numeric,
  avg_rating numeric,
  median_rating numeric,
  top5_avg_rating numeric,
  -- Search-surfaced (primary, filtered extremes)
  search_primary_surfaced integer,
  search_primary_outside_radius integer,
  search_outside_share numeric,
  top10_competitors jsonb not null default '[]'::jsonb,
  anomaly_notes text,
  computed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.loa_roofing_competition enable row level security;

drop policy if exists "anon_read_loa_roofing_competition" on public.loa_roofing_competition;
create policy "anon_read_loa_roofing_competition"
  on public.loa_roofing_competition for select to anon, authenticated using (true);

grant select on public.loa_roofing_competition to anon, authenticated;

comment on table public.loa_roofing_competition is
  'Per-LOA roofing competition metrics from GBP discovery. No Opportunity Score.';

-- ---------------------------------------------------------------------------
-- Demographic quality flags on LOAs
-- ---------------------------------------------------------------------------
alter table public.local_opportunity_areas
  add column if not exists demo_quality_flag text
    check (demo_quality_flag is null or demo_quality_flag in ('ok', 'review', 'incomplete')),
  add column if not exists demo_quality_notes text;

comment on column public.local_opportunity_areas.demo_quality_flag is
  'ok | review | incomplete — flag only; does not overhaul ZCTA methodology.';
