-- Phase A.1: Grid-based expansion research foundation (additive).
-- Enables PostGIS and adds study regions, unified locations (grid candidates +
-- benchmarks), radius-keyed ring metrics, and location-competitor joins.
--
-- Preserves all Phase A tables, seeds, and UI contracts.
-- Does NOT insert study boundaries, grid points, benchmarks, metrics, or scores.
-- Does NOT create opportunity-zone tables (deferred until clustering methodology
-- is defined from real grid data).
--
-- Future requirements (document only):
-- 1. Opportunity zones: after real grid data exists, design clustering of
--    neighboring high-opportunity points into zones. Do not invent zone schema yet.
-- 2. Grid generation: use a proper PostGIS distance-based method so ~2-mile
--    spacing is real-world miles at any latitude. Do NOT use approximate
--    lat/lng degree stepping. Do not generate points in this migration.

-- ---------------------------------------------------------------------------
-- PostGIS
-- ---------------------------------------------------------------------------
create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- Clarify Phase A market role (no structural change)
-- ---------------------------------------------------------------------------
comment on table public.expansion_markets is
  'Named reference areas, manually researched areas, and eventual finalist / opportunity containers. Not the primary Pass 1-5 analytical unit; grid locations drive spatial opportunity analysis.';

-- ---------------------------------------------------------------------------
-- Helper: sync geography(Point) from numeric lat/lng
-- ---------------------------------------------------------------------------
create or replace function public.expansion_sync_point_geom()
returns trigger
language plpgsql
as $$
begin
  if new.latitude is not null and new.longitude is not null then
    new.geom :=
      st_setsrid(
        st_makepoint(new.longitude::double precision, new.latitude::double precision),
        4326
      )::geography;
  else
    new.geom := null;
  end if;
  return new;
end;
$$;

comment on function public.expansion_sync_point_geom() is
  'Keeps geography(Point,4326) geom in sync with numeric latitude/longitude on expansion location/competitor rows.';

-- ---------------------------------------------------------------------------
-- 1. expansion_study_regions
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_study_regions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.expansion_projects(id) on delete cascade,
  slug text not null,
  name text not null,
  boundary geography(MultiPolygon, 4326),
  boundary_geojson jsonb,
  methodology text,
  source_notes text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create index if not exists expansion_study_regions_project_idx
  on public.expansion_study_regions (project_id);
create index if not exists expansion_study_regions_boundary_gix
  on public.expansion_study_regions using gist (boundary);

alter table public.expansion_study_regions enable row level security;

drop policy if exists "anon_read_expansion_study_regions"
  on public.expansion_study_regions;
create policy "anon_read_expansion_study_regions"
  on public.expansion_study_regions
  for select to anon, authenticated using (true);

grant select on public.expansion_study_regions to anon, authenticated;

comment on table public.expansion_study_regions is
  'Reusable study-area polygons for an expansion project. Grid candidates are generated inside an active boundary using PostGIS distance-based spacing (future), not city lists.';
comment on column public.expansion_study_regions.boundary is
  'Canonical MultiPolygon geography (WGS84). Nullable until a boundary is defined.';
comment on column public.expansion_study_regions.boundary_geojson is
  'Optional GeoJSON mirror for application convenience; keep consistent with boundary when both are set.';

-- ---------------------------------------------------------------------------
-- 2. expansion_locations (grid candidates + existing-location benchmarks)
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_locations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.expansion_projects(id) on delete cascade,
  study_region_id uuid references public.expansion_study_regions(id) on delete set null,
  location_type text not null
    check (location_type in ('grid_candidate', 'benchmark_existing')),
  latitude numeric not null,
  longitude numeric not null,
  geom geography(Point, 4326),
  grid_spacing_miles numeric,
  grid_version text,
  location_label text,
  place_id text,
  address text,
  status text not null default 'active'
    check (status in (
      'active',
      'inactive',
      'screened_out',
      'deep_dive'
    )),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    location_type <> 'grid_candidate'
    or (grid_spacing_miles is not null and grid_version is not null)
  ),
  check (
    location_type <> 'benchmark_existing'
    or place_id is not null
    or address is not null
    or location_label is not null
  )
);

-- Unique grid coordinates per project/version (rounded to ~0.1 m)
create unique index if not exists expansion_locations_grid_coord_uidx
  on public.expansion_locations (
    project_id,
    grid_version,
    (round(latitude::numeric, 6)),
    (round(longitude::numeric, 6))
  )
  where location_type = 'grid_candidate' and grid_version is not null;

create unique index if not exists expansion_locations_benchmark_place_uidx
  on public.expansion_locations (project_id, place_id)
  where location_type = 'benchmark_existing' and place_id is not null;

create index if not exists expansion_locations_project_type_idx
  on public.expansion_locations (project_id, location_type, status);
create index if not exists expansion_locations_study_region_idx
  on public.expansion_locations (study_region_id);
create index if not exists expansion_locations_geom_gix
  on public.expansion_locations using gist (geom);

drop trigger if exists expansion_locations_sync_geom on public.expansion_locations;
create trigger expansion_locations_sync_geom
  before insert or update of latitude, longitude
  on public.expansion_locations
  for each row
  execute function public.expansion_sync_point_geom();

alter table public.expansion_locations enable row level security;

drop policy if exists "anon_read_expansion_locations" on public.expansion_locations;
create policy "anon_read_expansion_locations"
  on public.expansion_locations
  for select to anon, authenticated using (true);

grant select on public.expansion_locations to anon, authenticated;

comment on table public.expansion_locations is
  'Primary analytical units: ~2-mile grid candidates and existing-company benchmark locations. Same ring-metric engine for both. Not city markets.';
comment on column public.expansion_locations.geom is
  'PostGIS geography(Point,4326) synced from latitude/longitude via trigger.';
comment on column public.expansion_locations.grid_version is
  'Version label for a generated candidate set (e.g. v1-2mi). Future generation must use PostGIS real-world distance spacing, not degree stepping.';

-- ---------------------------------------------------------------------------
-- 3. expansion_location_demographics (per location + radius)
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_location_demographics (
  location_id uuid not null references public.expansion_locations(id) on delete cascade,
  radius_miles numeric not null check (radius_miles > 0),
  population integer,
  households integer,
  owner_occupied_households integer,
  homeownership_rate numeric,
  single_family_detached_homes integer,
  median_household_income numeric,
  median_home_value numeric,
  housing_units integer,
  housing_growth numeric,
  household_growth numeric,
  housing_age_distribution jsonb,
  dataset_year integer,
  baseline_dataset_year integer,
  data_source text,
  collection_date date,
  methodology_version text,
  data_quality text
    check (
      data_quality is null
      or data_quality in ('verified', 'estimated', 'partial', 'needs_review')
    ),
  quality_notes text,
  computed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (location_id, radius_miles)
);

create index if not exists expansion_location_demographics_radius_idx
  on public.expansion_location_demographics (radius_miles);

alter table public.expansion_location_demographics enable row level security;

drop policy if exists "anon_read_expansion_location_demographics"
  on public.expansion_location_demographics;
create policy "anon_read_expansion_location_demographics"
  on public.expansion_location_demographics
  for select to anon, authenticated using (true);

grant select on public.expansion_location_demographics to anon, authenticated;

comment on table public.expansion_location_demographics is
  'Demographic ring metrics for a location. Typical radii: 5 (core) and 10 (primary). Radius is not hard-coded to those values.';

-- ---------------------------------------------------------------------------
-- 4. expansion_location_competition (per location + radius + industry)
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_location_competition (
  location_id uuid not null references public.expansion_locations(id) on delete cascade,
  radius_miles numeric not null check (radius_miles > 0),
  industry text not null,
  total_competitors integer,
  dedicated_count integer,
  roofing_exterior_count integer,
  cleaning_repair_count integer,
  competitors_50_plus integer,
  competitors_100_plus integer,
  competitors_250_plus integer,
  competitors_500_plus integer,
  competitors_1000_plus integer,
  median_competitor_reviews numeric,
  top3_avg_reviews numeric,
  top5_avg_reviews numeric,
  owner_hh_per_dedicated numeric,
  single_family_hh_per_dedicated numeric,
  data_source text,
  collection_date date,
  methodology_version text,
  data_quality text
    check (
      data_quality is null
      or data_quality in ('verified', 'estimated', 'partial', 'needs_review')
    ),
  quality_notes text,
  computed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (location_id, radius_miles, industry)
);

create index if not exists expansion_location_competition_industry_idx
  on public.expansion_location_competition (industry, radius_miles);

alter table public.expansion_location_competition enable row level security;

drop policy if exists "anon_read_expansion_location_competition"
  on public.expansion_location_competition;
create policy "anon_read_expansion_location_competition"
  on public.expansion_location_competition
  for select to anon, authenticated using (true);

grant select on public.expansion_location_competition to anon, authenticated;

comment on table public.expansion_location_competition is
  'Competition rollups within a radius of a location, by industry. Prefer regional competitor discovery + spatial association over per-point scraping.';

-- ---------------------------------------------------------------------------
-- 5. expansion_location_environment (per location + radius)
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_location_environment (
  location_id uuid not null references public.expansion_locations(id) on delete cascade,
  radius_miles numeric not null check (radius_miles > 0),
  tree_canopy numeric,
  rainfall numeric,
  storm_indicators jsonb,
  extra jsonb not null default '{}'::jsonb,
  dataset_year integer,
  data_source text,
  collection_date date,
  methodology_version text,
  data_quality text
    check (
      data_quality is null
      or data_quality in ('verified', 'estimated', 'partial', 'needs_review')
    ),
  quality_notes text,
  computed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (location_id, radius_miles)
);

create index if not exists expansion_location_environment_radius_idx
  on public.expansion_location_environment (radius_miles);

alter table public.expansion_location_environment enable row level security;

drop policy if exists "anon_read_expansion_location_environment"
  on public.expansion_location_environment;
create policy "anon_read_expansion_location_environment"
  on public.expansion_location_environment
  for select to anon, authenticated using (true);

grant select on public.expansion_location_environment to anon, authenticated;

comment on table public.expansion_location_environment is
  'Environment / demand ring metrics. Typed columns for known signals; extra jsonb for extensible demand fields. No scoring.';

-- ---------------------------------------------------------------------------
-- 6. expansion_location_competitors (persisted spatial associations)
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_location_competitors (
  location_id uuid not null references public.expansion_locations(id) on delete cascade,
  place_id text not null references public.expansion_competitors(place_id) on delete cascade,
  distance_miles numeric not null check (distance_miles >= 0),
  within_radius_miles numeric[] not null default '{}',
  computed_at timestamptz not null default now(),
  methodology_version text,
  notes text,
  primary key (location_id, place_id)
);

create index if not exists expansion_location_competitors_place_idx
  on public.expansion_location_competitors (place_id);
create index if not exists expansion_location_competitors_distance_idx
  on public.expansion_location_competitors (location_id, distance_miles);

alter table public.expansion_location_competitors enable row level security;

drop policy if exists "anon_read_expansion_location_competitors"
  on public.expansion_location_competitors;
create policy "anon_read_expansion_location_competitors"
  on public.expansion_location_competitors
  for select to anon, authenticated using (true);

grant select on public.expansion_location_competitors to anon, authenticated;

comment on table public.expansion_location_competitors is
  'Persisted distances from locations to discovered competitors (typically within the largest analysis ring, e.g. 10 miles). Rollups live in expansion_location_competition.';

-- ---------------------------------------------------------------------------
-- 7. Additive PostGIS geom on expansion_competitors
-- ---------------------------------------------------------------------------
alter table public.expansion_competitors
  add column if not exists geom geography(Point, 4326);

create index if not exists expansion_competitors_geom_gix
  on public.expansion_competitors using gist (geom);

drop trigger if exists expansion_competitors_sync_geom on public.expansion_competitors;
create trigger expansion_competitors_sync_geom
  before insert or update of latitude, longitude
  on public.expansion_competitors
  for each row
  execute function public.expansion_sync_point_geom();

-- Backfill geom for any existing rows that already have coordinates
update public.expansion_competitors
set geom =
  st_setsrid(
    st_makepoint(longitude::double precision, latitude::double precision),
    4326
  )::geography
where latitude is not null
  and longitude is not null
  and geom is null;

comment on column public.expansion_competitors.geom is
  'PostGIS geography(Point,4326) synced from latitude/longitude. Additive; nullable when coordinates are unknown.';
