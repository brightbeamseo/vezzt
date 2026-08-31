-- Local Opportunity Areas (Phase II): 15-mile analytical units under macro markets.
-- Does not invent scores. Does not run Apify discovery.

create table if not exists public.local_opportunity_areas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  display_name text not null,
  state text not null,
  macro_market_id uuid not null references public.markets(id) on delete cascade,
  center_lat numeric not null,
  center_lng numeric not null,
  radius_miles numeric not null default 15,
  place_geoid text,
  place_name text,
  place_population integer,
  selection_rank integer,
  companion_places text[],
  -- Aggregated ZCTA demographics (counts summed; medians household-weighted)
  population integer,
  households integer,
  housing_units integer,
  owner_occupied_units integer,
  owner_occupied_rate numeric,
  owner_occupied_per_1k_residents numeric,
  median_household_income numeric,
  median_home_value numeric,
  median_year_structure_built numeric,
  single_family_detached_units integer,
  single_family_share numeric,
  population_growth numeric,
  household_growth numeric,
  housing_growth numeric,
  zcta_count integer,
  zcta_codes text[],
  dataset_year integer,
  baseline_dataset_year integer,
  data_source text,
  aggregation_method text,
  last_updated timestamptz,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists loa_macro_market_id_idx
  on public.local_opportunity_areas (macro_market_id);

create index if not exists loa_state_idx
  on public.local_opportunity_areas (state);

create index if not exists loa_population_idx
  on public.local_opportunity_areas (population desc nulls last);

alter table public.local_opportunity_areas enable row level security;

drop policy if exists "anon_read_local_opportunity_areas" on public.local_opportunity_areas;
create policy "anon_read_local_opportunity_areas"
  on public.local_opportunity_areas
  for select
  to anon, authenticated
  using (true);

grant select on public.local_opportunity_areas to anon, authenticated;

comment on table public.local_opportunity_areas is
  '15-mile Local Opportunity Areas for roofing expansion analysis. Demographics from ACS ZCTA aggregation. Competition not calculated yet.';

create table if not exists public.loa_zctas (
  loa_id uuid not null references public.local_opportunity_areas(id) on delete cascade,
  zip_code text not null,
  distance_miles numeric,
  population integer,
  households integer,
  primary key (loa_id, zip_code)
);

create index if not exists loa_zctas_zip_idx on public.loa_zctas (zip_code);

alter table public.loa_zctas enable row level security;

drop policy if exists "anon_read_loa_zctas" on public.loa_zctas;
create policy "anon_read_loa_zctas"
  on public.loa_zctas
  for select
  to anon, authenticated
  using (true);

grant select on public.loa_zctas to anon, authenticated;

comment on table public.loa_zctas is
  'ZCTAs whose centroids fall within a Local Opportunity Area 15-mile radius.';
