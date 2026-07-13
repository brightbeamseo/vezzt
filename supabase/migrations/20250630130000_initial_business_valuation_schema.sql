-- Initial schema for local business valuation platform (MVP).
-- Raw review snapshots are kept separate from calculated metrics.

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. businesses
-- ---------------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  google_place_id text unique,
  name text not null,
  primary_category text,
  secondary_categories text[],
  website_url text,
  phone text,
  address text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',
  latitude numeric,
  longitude numeric,
  google_maps_url text,
  is_active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index businesses_city_state_idx on public.businesses (city, state);
create index businesses_primary_category_idx on public.businesses (primary_category);

create trigger businesses_set_updated_at
before update on public.businesses
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. business_locations
-- ---------------------------------------------------------------------------

create table public.business_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  google_place_id text unique,
  name text,
  address text,
  city text,
  state text,
  postal_code text,
  phone text,
  latitude numeric,
  longitude numeric,
  google_maps_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index business_locations_business_id_idx on public.business_locations (business_id);

create trigger business_locations_set_updated_at
before update on public.business_locations
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. review_snapshots
-- ---------------------------------------------------------------------------

create table public.review_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  snapshot_date date not null default current_date,
  review_count integer,
  average_rating numeric(3, 2),
  source text not null default 'google',
  created_at timestamptz not null default now(),
  unique (business_id, snapshot_date, source)
);

create index review_snapshots_business_id_snapshot_date_idx
  on public.review_snapshots (business_id, snapshot_date);

create index review_snapshots_snapshot_date_idx
  on public.review_snapshots (snapshot_date);

-- ---------------------------------------------------------------------------
-- 4. business_metrics
-- ---------------------------------------------------------------------------

create table public.business_metrics (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  reviews_30d integer,
  reviews_90d integer,
  reviews_12mo integer,
  review_velocity_monthly numeric,
  rating_change_90d numeric,
  estimated_annual_revenue numeric,
  estimated_sde numeric,
  estimated_ebitda numeric,
  estimated_value_low numeric,
  estimated_value_mid numeric,
  estimated_value_high numeric,
  confidence_score numeric,
  acquisition_score numeric,
  updated_at timestamptz not null default now()
);

create index business_metrics_estimated_value_mid_idx
  on public.business_metrics (estimated_value_mid);

create index business_metrics_acquisition_score_idx
  on public.business_metrics (acquisition_score);

create index business_metrics_review_velocity_monthly_idx
  on public.business_metrics (review_velocity_monthly);

create trigger business_metrics_set_updated_at
before update on public.business_metrics
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. business_enrichment
-- ---------------------------------------------------------------------------

create table public.business_enrichment (
  business_id uuid primary key references public.businesses (id) on delete cascade,
  employee_count_estimate integer,
  linkedin_url text,
  facebook_url text,
  instagram_url text,
  years_in_business integer,
  founded_year integer,
  entity_name text,
  entity_status text,
  owner_names text[],
  ads_detected boolean,
  seo_traffic_estimate integer,
  notes text,
  updated_at timestamptz not null default now()
);

create trigger business_enrichment_set_updated_at
before update on public.business_enrichment
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. scrape_runs
-- ---------------------------------------------------------------------------

create table public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  query text,
  city text,
  state text,
  category text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  records_found integer not null default 0,
  records_created integer not null default 0,
  records_updated integer not null default 0,
  error_message text
);

create index scrape_runs_started_at_idx on public.scrape_runs (started_at desc);
create index scrape_runs_status_idx on public.scrape_runs (status);

-- ---------------------------------------------------------------------------
-- Row Level Security (no public policies yet — service role / server-side only)
-- ---------------------------------------------------------------------------

alter table public.businesses enable row level security;
alter table public.business_locations enable row level security;
alter table public.review_snapshots enable row level security;
alter table public.business_metrics enable row level security;
alter table public.business_enrichment enable row level security;
alter table public.scrape_runs enable row level security;
