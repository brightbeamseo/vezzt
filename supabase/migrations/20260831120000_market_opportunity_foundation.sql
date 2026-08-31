-- Phase 1 Market Opportunity: extend markets for multi-state metros,
-- localities, growth provenance, and roofing-relevant housing metrics.
-- Does not invent scores. Does not break existing Boise business FK links.

-- ---------------------------------------------------------------------------
-- 1. Extend public.markets
-- ---------------------------------------------------------------------------

alter table public.markets
  add column if not exists states text[],
  add column if not exists center_lat numeric,
  add column if not exists center_lng numeric,
  add column if not exists household_growth numeric,
  add column if not exists single_family_detached_units integer,
  add column if not exists single_family_share numeric,
  add column if not exists owner_occupied_per_1k_residents numeric,
  add column if not exists baseline_dataset_year integer,
  add column if not exists geography_name text,
  add column if not exists opportunity_enabled boolean not null default false;

-- Backfill states[] from legacy single state column.
update public.markets
set states = array[state]
where state is not null
  and (states is null or cardinality(states) = 0);

-- Existing Boise Metro participates in opportunity screening.
update public.markets
set opportunity_enabled = true
where market_slug = 'boise-metro';

create index if not exists markets_opportunity_enabled_idx
  on public.markets (opportunity_enabled)
  where opportunity_enabled = true;

create index if not exists markets_states_gin_idx
  on public.markets using gin (states);

comment on column public.markets.states is
  'State abbreviations or full names included in the market (supports cross-state metros).';
comment on column public.markets.center_lat is
  'Primary market-center latitude for future Maps discovery.';
comment on column public.markets.center_lng is
  'Primary market-center longitude for future Maps discovery.';
comment on column public.markets.household_growth is
  'Percent change in households between baseline ACS vintage and current dataset_year.';
comment on column public.markets.single_family_detached_units is
  'ACS 1-unit detached housing units (B25024_002E).';
comment on column public.markets.single_family_share is
  'single_family_detached_units / housing_units (0-1).';
comment on column public.markets.owner_occupied_per_1k_residents is
  '(owner_occupied_units / population) * 1000.';
comment on column public.markets.baseline_dataset_year is
  'ACS vintage used as the growth comparison base (e.g. 2019 vs 2024).';
comment on column public.markets.geography_name is
  'Official Census ACS NAME for the CBSA/micro area when available.';
comment on column public.markets.opportunity_enabled is
  'True for markets included in Market Opportunity demographic screening.';

-- ---------------------------------------------------------------------------
-- 2. Market localities (cities/places inside a market)
-- ---------------------------------------------------------------------------

create table if not exists public.market_localities (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references public.markets(id) on delete cascade,
  city_name text not null,
  state text not null,
  latitude numeric,
  longitude numeric,
  zoom integer default 13,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (market_id, city_name, state)
);

create index if not exists market_localities_market_id_idx
  on public.market_localities (market_id);

alter table public.market_localities enable row level security;

drop policy if exists "anon_read_market_localities" on public.market_localities;
create policy "anon_read_market_localities"
  on public.market_localities
  for select
  to anon, authenticated
  using (true);

grant select on public.market_localities to anon, authenticated;

comment on table public.market_localities is
  'Cities/localities belonging to a market. Used for membership and future Maps discovery centers.';
