-- Phase A: Market Expansion Research schema (vertical-agnostic).
-- Central Texas Gutter Expansion seed: project + candidate market shells only.
-- No fabricated demographics, competition, environment, or scores.
--
-- Note: Candidate markets may overlap geographically. They are research units,
-- not independent non-overlapping demand basins. Overlap tables deferred.

-- ---------------------------------------------------------------------------
-- Helpers: data quality enum values (text + check)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. expansion_projects
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  industry text not null,
  region_label text not null,
  states text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active', 'archived')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.expansion_projects enable row level security;

drop policy if exists "anon_read_expansion_projects" on public.expansion_projects;
create policy "anon_read_expansion_projects"
  on public.expansion_projects for select to anon, authenticated using (true);

grant select on public.expansion_projects to anon, authenticated;

comment on table public.expansion_projects is
  'Reusable regional expansion research projects (e.g. Central Texas gutters).';

-- ---------------------------------------------------------------------------
-- 2. expansion_markets
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_markets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.expansion_projects(id) on delete cascade,
  slug text not null,
  display_name text not null,
  state text not null,
  center_lat numeric,
  center_lng numeric,
  radius_miles numeric,
  geography_type text not null default 'radius',
  geography_methodology text,
  status text not null default 'research_candidate'
    check (status in (
      'research_candidate',
      'active',
      'watchlist',
      'rejected',
      'deferred'
    )),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, slug)
);

create index if not exists expansion_markets_project_idx
  on public.expansion_markets (project_id);
create index if not exists expansion_markets_status_idx
  on public.expansion_markets (status);

alter table public.expansion_markets enable row level security;

drop policy if exists "anon_read_expansion_markets" on public.expansion_markets;
create policy "anon_read_expansion_markets"
  on public.expansion_markets for select to anon, authenticated using (true);

grant select on public.expansion_markets to anon, authenticated;

comment on table public.expansion_markets is
  'Candidate markets within an expansion project. Geography type defaults to radius but is not exclusive. Markets may overlap; do not treat as independent demand.';

comment on column public.expansion_markets.geography_type is
  'How the market geography is defined (e.g. radius, place, zip_list, polygon).';
comment on column public.expansion_markets.geography_methodology is
  'Human-readable method for defining this market geography.';

-- ---------------------------------------------------------------------------
-- 3. expansion_market_zips
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_market_zips (
  market_id uuid not null references public.expansion_markets(id) on delete cascade,
  zip_code text not null,
  notes text,
  primary key (market_id, zip_code)
);

create index if not exists expansion_market_zips_zip_idx
  on public.expansion_market_zips (zip_code);

alter table public.expansion_market_zips enable row level security;

drop policy if exists "anon_read_expansion_market_zips" on public.expansion_market_zips;
create policy "anon_read_expansion_market_zips"
  on public.expansion_market_zips for select to anon, authenticated using (true);

grant select on public.expansion_market_zips to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. expansion_market_demographics
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_market_demographics (
  market_id uuid primary key references public.expansion_markets(id) on delete cascade,
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
  updated_at timestamptz not null default now()
);

alter table public.expansion_market_demographics enable row level security;

drop policy if exists "anon_read_expansion_market_demographics"
  on public.expansion_market_demographics;
create policy "anon_read_expansion_market_demographics"
  on public.expansion_market_demographics
  for select to anon, authenticated using (true);

grant select on public.expansion_market_demographics to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. expansion_market_environment
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_market_environment (
  market_id uuid primary key references public.expansion_markets(id) on delete cascade,
  tree_canopy numeric,
  rainfall numeric,
  storm_indicators jsonb,
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
  updated_at timestamptz not null default now()
);

alter table public.expansion_market_environment enable row level security;

drop policy if exists "anon_read_expansion_market_environment"
  on public.expansion_market_environment;
create policy "anon_read_expansion_market_environment"
  on public.expansion_market_environment
  for select to anon, authenticated using (true);

grant select on public.expansion_market_environment to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. expansion_competitors (identity / canonical current GBP)
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_competitors (
  place_id text primary key,
  business_name text,
  address text,
  latitude numeric,
  longitude numeric,
  website text,
  phone text,
  category_name text,
  categories text[] not null default '{}',
  rating numeric,
  reviews_count integer,
  raw jsonb,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text
);

create index if not exists expansion_competitors_reviews_idx
  on public.expansion_competitors (reviews_count desc nulls last);
create index if not exists expansion_competitors_name_idx
  on public.expansion_competitors (business_name);

alter table public.expansion_competitors enable row level security;

drop policy if exists "anon_read_expansion_competitors" on public.expansion_competitors;
create policy "anon_read_expansion_competitors"
  on public.expansion_competitors for select to anon, authenticated using (true);

grant select on public.expansion_competitors to anon, authenticated;

comment on table public.expansion_competitors is
  'Industry-agnostic GBP business identity and current canonical fields. Vertical classification is separate. Review history is in snapshots.';

-- ---------------------------------------------------------------------------
-- 7. expansion_competitor_classifications
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_competitor_classifications (
  id uuid primary key default gen_random_uuid(),
  place_id text not null references public.expansion_competitors(place_id) on delete cascade,
  industry text not null,
  classification text not null,
  is_primary_competitor boolean not null default false,
  confidence text,
  methodology_version text,
  classified_at timestamptz not null default now(),
  notes text,
  unique (place_id, industry)
);

create index if not exists expansion_competitor_classifications_industry_idx
  on public.expansion_competitor_classifications (industry, classification);

alter table public.expansion_competitor_classifications enable row level security;

drop policy if exists "anon_read_expansion_competitor_classifications"
  on public.expansion_competitor_classifications;
create policy "anon_read_expansion_competitor_classifications"
  on public.expansion_competitor_classifications
  for select to anon, authenticated using (true);

grant select on public.expansion_competitor_classifications to anon, authenticated;

comment on table public.expansion_competitor_classifications is
  'Per-industry competitor labeling. Same Place ID may be classified differently for gutters, roofing, siding, etc.';

-- ---------------------------------------------------------------------------
-- 8. expansion_competitor_snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_competitor_snapshots (
  id uuid primary key default gen_random_uuid(),
  place_id text not null references public.expansion_competitors(place_id) on delete cascade,
  reviews_count integer,
  rating numeric,
  category_name text,
  categories text[] not null default '{}',
  captured_at timestamptz not null default now(),
  data_source text,
  raw jsonb
);

create index if not exists expansion_competitor_snapshots_place_time_idx
  on public.expansion_competitor_snapshots (place_id, captured_at desc);

alter table public.expansion_competitor_snapshots enable row level security;

drop policy if exists "anon_read_expansion_competitor_snapshots"
  on public.expansion_competitor_snapshots;
create policy "anon_read_expansion_competitor_snapshots"
  on public.expansion_competitor_snapshots
  for select to anon, authenticated using (true);

grant select on public.expansion_competitor_snapshots to anon, authenticated;

comment on table public.expansion_competitor_snapshots is
  'Historical GBP review/rating/category captures for velocity analysis. Do not rely on overwriting expansion_competitors alone.';

-- ---------------------------------------------------------------------------
-- 9. expansion_market_competitors
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_market_competitors (
  market_id uuid not null references public.expansion_markets(id) on delete cascade,
  place_id text not null references public.expansion_competitors(place_id) on delete cascade,
  in_radius boolean,
  distance_miles numeric,
  discovered_at timestamptz not null default now(),
  notes text,
  primary key (market_id, place_id)
);

create index if not exists expansion_market_competitors_place_idx
  on public.expansion_market_competitors (place_id);

alter table public.expansion_market_competitors enable row level security;

drop policy if exists "anon_read_expansion_market_competitors"
  on public.expansion_market_competitors;
create policy "anon_read_expansion_market_competitors"
  on public.expansion_market_competitors
  for select to anon, authenticated using (true);

grant select on public.expansion_market_competitors to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. expansion_competition_metrics
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_competition_metrics (
  market_id uuid not null references public.expansion_markets(id) on delete cascade,
  industry text not null,
  total_discovered integer,
  dedicated_count integer,
  roofing_exterior_count integer,
  cleaning_repair_count integer,
  reviews_50_plus integer,
  reviews_100_plus integer,
  reviews_250_plus integer,
  reviews_500_plus integer,
  reviews_1000_plus integer,
  median_reviews numeric,
  top3_avg_reviews numeric,
  top5_avg_reviews numeric,
  competitors_per_owner_hh numeric,
  owner_hh_per_dedicated numeric,
  computed_at timestamptz,
  methodology_version text,
  data_source text,
  data_quality text
    check (
      data_quality is null
      or data_quality in ('verified', 'estimated', 'partial', 'needs_review')
    ),
  quality_notes text,
  primary key (market_id, industry)
);

alter table public.expansion_competition_metrics enable row level security;

drop policy if exists "anon_read_expansion_competition_metrics"
  on public.expansion_competition_metrics;
create policy "anon_read_expansion_competition_metrics"
  on public.expansion_competition_metrics
  for select to anon, authenticated using (true);

grant select on public.expansion_competition_metrics to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. expansion_digital_observations
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_digital_observations (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.expansion_markets(id) on delete cascade,
  channel text not null
    check (channel in ('maps', 'organic', 'lsa', 'ads')),
  observation text not null,
  observed_at timestamptz not null default now(),
  observer text,
  source_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists expansion_digital_observations_market_idx
  on public.expansion_digital_observations (market_id, channel);

alter table public.expansion_digital_observations enable row level security;

drop policy if exists "anon_read_expansion_digital_observations"
  on public.expansion_digital_observations;
create policy "anon_read_expansion_digital_observations"
  on public.expansion_digital_observations
  for select to anon, authenticated using (true);

grant select on public.expansion_digital_observations to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. expansion_scores (all score fields nullable; no formula)
-- ---------------------------------------------------------------------------
create table if not exists public.expansion_scores (
  market_id uuid not null references public.expansion_markets(id) on delete cascade,
  model_version text not null,
  market_potential_score numeric,
  competition_score numeric,
  maps_opportunity_score numeric,
  demographic_score numeric,
  demand_score numeric,
  final_opportunity_score numeric,
  analyst_notes text,
  risks text,
  attractive_reasons text,
  status text,
  computed_at timestamptz,
  primary key (market_id, model_version)
);

alter table public.expansion_scores enable row level security;

drop policy if exists "anon_read_expansion_scores" on public.expansion_scores;
create policy "anon_read_expansion_scores"
  on public.expansion_scores for select to anon, authenticated using (true);

grant select on public.expansion_scores to anon, authenticated;

comment on table public.expansion_scores is
  'Component and final opportunity scores. All numeric scores nullable. No formula is implied by this schema.';

-- ---------------------------------------------------------------------------
-- Seed: Central Texas Gutter Expansion + candidate market shells
-- ---------------------------------------------------------------------------
insert into public.expansion_projects (
  slug, name, industry, region_label, states, status, notes
)
values (
  'central-texas',
  'Central Texas Gutter Expansion',
  'gutter_installation',
  'San Antonio-Austin Corridor',
  array['Texas'],
  'active',
  'Internal research project. Candidate markets are research units only, not recommendations. Markets may overlap.'
)
on conflict (slug) do update set
  name = excluded.name,
  industry = excluded.industry,
  region_label = excluded.region_label,
  states = excluded.states,
  status = excluded.status,
  notes = excluded.notes,
  updated_at = now();

with project as (
  select id from public.expansion_projects where slug = 'central-texas'
),
candidates (slug, display_name, sort_order) as (
  values
    ('austin', 'Austin', 10),
    ('round-rock', 'Round Rock', 20),
    ('georgetown', 'Georgetown', 30),
    ('leander', 'Leander', 40),
    ('cedar-park', 'Cedar Park', 50),
    ('pflugerville', 'Pflugerville', 60),
    ('hutto', 'Hutto', 70),
    ('kyle', 'Kyle', 80),
    ('buda', 'Buda', 90),
    ('dripping-springs', 'Dripping Springs', 100),
    ('bastrop', 'Bastrop', 110),
    ('san-marcos', 'San Marcos', 120),
    ('new-braunfels', 'New Braunfels', 130),
    ('seguin', 'Seguin', 140),
    ('schertz', 'Schertz', 150),
    ('cibolo', 'Cibolo', 160),
    ('boerne', 'Boerne', 170),
    ('bulverde-spring-branch', 'Bulverde / Spring Branch', 180)
)
insert into public.expansion_markets (
  project_id,
  slug,
  display_name,
  state,
  geography_type,
  status,
  sort_order
)
select
  project.id,
  candidates.slug,
  candidates.display_name,
  'Texas',
  'radius',
  'research_candidate',
  candidates.sort_order
from project
cross join candidates
on conflict (project_id, slug) do update set
  display_name = excluded.display_name,
  state = excluded.state,
  geography_type = excluded.geography_type,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();
