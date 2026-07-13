-- Monitoring tiers + collection rejection log for market-based discovery.

alter table public.businesses
  add column if not exists monitoring_tier smallint
    check (monitoring_tier is null or monitoring_tier in (1, 2, 3)),
  add column if not exists monitoring_frequency text
    check (
      monitoring_frequency is null
      or monitoring_frequency in ('weekly', 'monthly', 'quarterly')
    ),
  add column if not exists last_monitored_at timestamptz,
  add column if not exists next_monitor_at timestamptz;

create index if not exists businesses_monitoring_tier_idx
  on public.businesses (monitoring_tier)
  where monitoring_tier is not null;

create index if not exists businesses_next_monitor_at_idx
  on public.businesses (next_monitor_at)
  where next_monitor_at is not null;

-- Velocity fields on business_metrics (nullable until 2+ snapshots)
alter table public.business_metrics
  add column if not exists reviews_since_previous integer,
  add column if not exists reviews_gained_approx_30d integer,
  add column if not exists reviews_gained_approx_90d integer,
  add column if not exists avg_weekly_review_velocity numeric,
  add column if not exists estimated_monthly_review_velocity numeric,
  add column if not exists review_acceleration numeric;

-- Outside-market / hard rejections (sector excludes stay on businesses)
create table if not exists public.collection_rejections (
  id uuid primary key default gen_random_uuid(),
  market_id text not null,
  google_place_id text,
  name text,
  city text,
  primary_category text,
  rejection_stage text not null
    check (rejection_stage in ('market', 'sector', 'duplicate', 'invalid')),
  reason text not null,
  source text not null default 'google_apify',
  scrape_run_id uuid references public.scrape_runs (id) on delete set null,
  raw jsonb,
  created_at timestamptz not null default now()
);

create index if not exists collection_rejections_market_id_idx
  on public.collection_rejections (market_id);

create index if not exists collection_rejections_created_at_idx
  on public.collection_rejections (created_at desc);

alter table public.collection_rejections enable row level security;

create policy "anon_read_collection_rejections"
  on public.collection_rejections
  for select
  to anon, authenticated
  using (true);

comment on column public.businesses.monitoring_tier is
  '1=weekly (100+ reviews), 2=monthly (25-99), 3=quarterly (<25); null if not monitoring.';
