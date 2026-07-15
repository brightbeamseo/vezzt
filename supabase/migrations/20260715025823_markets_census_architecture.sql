-- Market-level Census architecture.
-- Rebuilds public.markets (text PK → UUID PK + Census columns).
-- Migrates businesses.market_id from text slug → uuid FK.
-- Does not invent Census values. Does not call external APIs.

-- Drop dependent view before altering businesses.market_id
drop view if exists public.business_current_signals;

-- ---------------------------------------------------------------------------
-- 1. Replace markets table
-- ---------------------------------------------------------------------------

alter table if exists public.markets rename to markets_legacy_text;

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  market_name text not null,
  market_slug text not null unique,
  market_type text
    check (
      market_type is null
      or market_type in ('metro', 'msa', 'state', 'custom')
    ),
  cbsa_code text,
  state text,
  timezone text,
  population integer,
  households integer,
  housing_units integer,
  owner_occupied_units integer,
  owner_occupied_rate numeric,
  median_household_income numeric,
  median_home_value numeric,
  median_year_structure_built numeric,
  population_growth numeric,
  housing_growth numeric,
  annual_building_permits integer,
  dataset_year integer,
  data_source text,
  last_updated timestamptz,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists markets_market_type_idx on public.markets (market_type);
create index if not exists markets_cbsa_code_idx on public.markets (cbsa_code);

alter table public.markets enable row level security;

drop policy if exists "anon_read_markets" on public.markets;
create policy "anon_read_markets"
  on public.markets
  for select
  to anon, authenticated
  using (true);

grant select on public.markets to anon, authenticated;

comment on table public.markets is
  'Comparison geography for businesses. Census stats are market-level and shared — not duplicated onto businesses.';

-- Seed Boise Metro (Census fields intentionally NULL).
insert into public.markets (
  market_name,
  market_slug,
  market_type,
  state,
  timezone
)
values (
  'Boise Metro',
  'boise-metro',
  'metro',
  'Idaho',
  'America/Boise'
)
on conflict (market_slug) do update set
  market_name = excluded.market_name,
  market_type = excluded.market_type,
  state = excluded.state,
  timezone = excluded.timezone,
  updated_at = now();

-- Carry forward timezone from legacy markets when slug matches.
update public.markets m
set
  timezone = coalesce(m.timezone, l.timezone),
  market_name = coalesce(m.market_name, l.name),
  updated_at = now()
from public.markets_legacy_text l
where l.id = m.market_slug;

-- ---------------------------------------------------------------------------
-- 2. Migrate businesses.market_id text → uuid FK
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists market_id_uuid uuid;

update public.businesses b
set market_id_uuid = m.id
from public.markets m
where b.market_id is not null
  and trim(b.market_id) <> ''
  and m.market_slug = trim(b.market_id);

-- Link every Boise-area roofing business to Boise Metro (by prior slug or city allowlist).
update public.businesses b
set market_id_uuid = m.id
from public.markets m
where m.market_slug = 'boise-metro'
  and b.target_sector = 'roofing'
  and (
    b.market_id = 'boise-metro'
    or lower(trim(coalesce(b.city, ''))) in (
      'boise',
      'meridian',
      'nampa',
      'caldwell',
      'eagle',
      'kuna',
      'star',
      'garden city'
    )
  );

-- Any remaining rows still tagged with boise-metro text.
update public.businesses b
set market_id_uuid = m.id
from public.markets m
where m.market_slug = 'boise-metro'
  and b.market_id = 'boise-metro'
  and b.market_id_uuid is null;

alter table public.businesses drop column if exists market_id;

alter table public.businesses
  rename column market_id_uuid to market_id;

alter table public.businesses
  drop constraint if exists businesses_market_id_fkey;

alter table public.businesses
  add constraint businesses_market_id_fkey
  foreign key (market_id) references public.markets (id);

create index if not exists businesses_market_id_idx
  on public.businesses (market_id);

comment on column public.businesses.market_id is
  'FK to public.markets — primary comparison geography. city/postal_code remain descriptive.';

drop table if exists public.markets_legacy_text;

-- ---------------------------------------------------------------------------
-- 3. Recreate business_current_signals with market_slug + market fields
-- ---------------------------------------------------------------------------

create view public.business_current_signals
with (security_invoker = true)
as
with latest_review as (
  select distinct on (rs.business_id)
    rs.business_id,
    rs.id as review_snapshot_id,
    rs.snapshot_date as review_snapshot_date,
    rs.review_count,
    rs.average_rating,
    rs.source as review_source,
    rs.created_at as review_snapshot_created_at
  from public.review_snapshots rs
  order by rs.business_id, rs.snapshot_date desc, rs.created_at desc
),
prior_review as (
  select
    rs.business_id,
    rs.snapshot_date as prior_snapshot_date,
    rs.review_count as prior_review_count
  from (
    select
      rs.*,
      row_number() over (
        partition by rs.business_id
        order by rs.snapshot_date desc, rs.created_at desc
      ) as rn
    from public.review_snapshots rs
  ) rs
  where rs.rn = 2
),
review_counts as (
  select
    business_id,
    count(*)::int as review_snapshot_count
  from public.review_snapshots
  group by business_id
),
latest_seo_parent as (
  select distinct on (s.business_id)
    s.business_id,
    s.id as parent_seo_id,
    s.domain as parent_domain,
    s.analysis_target as parent_analysis_target,
    s.analysis_mode as parent_analysis_mode,
    s.search_scope as parent_search_scope,
    s.snapshot_date as parent_snapshot_date,
    s.domain_rating as parent_domain_rating,
    s.organic_traffic as parent_organic_traffic,
    s.organic_keywords as parent_organic_keywords,
    s.referring_domains as parent_referring_domains,
    s.backlinks as parent_backlinks,
    s.traffic_value as parent_traffic_value,
    s.created_at as parent_seo_created_at
  from public.seo_snapshots s
  where s.scope = 'company_domain'
  order by s.business_id, s.snapshot_date desc, s.created_at desc
),
latest_seo_local as (
  select distinct on (s.business_id)
    s.business_id,
    s.id as local_seo_id,
    s.analysis_target as local_analysis_target,
    s.analysis_mode as local_analysis_mode,
    s.search_scope as local_search_scope,
    s.location_path as local_location_path,
    s.snapshot_date as local_snapshot_date,
    s.domain_rating as local_domain_rating,
    s.organic_traffic as local_organic_traffic,
    s.organic_keywords as local_organic_keywords,
    s.organic_keywords_top3 as local_organic_keywords_top3,
    s.referring_domains as local_referring_domains,
    s.backlinks as local_backlinks,
    s.traffic_value as local_traffic_value,
    s.created_at as local_seo_created_at
  from public.seo_snapshots s
  where s.scope = 'business_location'
  order by s.business_id, s.snapshot_date desc, s.created_at desc
),
latest_map_rank as (
  select distinct on (m.business_id)
    m.business_id,
    m.id as map_rank_id,
    m.provider_scan_id,
    m.search_term as geogrid_search_term,
    m.scanned_at as geogrid_scanned_at,
    m.share_of_local_voice,
    m.average_grid_rank,
    m.average_total_grid_rank,
    m.found_in_top_3_count,
    m.found_in_top_10_count,
    m.total_grid_points,
    m.status as map_rank_status,
    m.created_at as map_rank_created_at
  from public.map_rank_snapshots m
  where m.status = 'finished'
  order by m.business_id, coalesce(m.scanned_at, m.created_at) desc
),
normalized_postal as (
  select
    b.id as business_id,
    nullif(left(regexp_replace(coalesce(b.postal_code, ''), '[^0-9]', '', 'g'), 5), '')
      as zip_code_normalized
  from public.businesses b
)
select
  b.id as business_id,
  b.name as business_name,
  b.city,
  b.state,
  b.postal_code,
  np.zip_code_normalized,
  b.website_url,
  b.google_maps_url,
  b.google_place_id,
  b.primary_category,
  b.target_sector,
  b.qualification_status,
  b.is_qualified,
  b.market_id,
  mk.market_slug,
  mk.market_name,
  mk.market_type,
  mk.timezone as market_timezone,
  b.analysis_target,
  b.analysis_mode,
  b.company_id,
  c.company_name,
  c.company_scale,
  c.ownership_model,
  c.location_count as company_location_count,
  c.root_domain as company_root_domain,
  c.classification_confidence,
  c.classification_reason,
  c.classification_is_manual,
  lr.review_snapshot_id,
  lr.review_snapshot_date,
  lr.review_count,
  lr.average_rating,
  lr.review_source,
  pr.prior_snapshot_date,
  pr.prior_review_count,
  case
    when lr.review_count is not null and pr.prior_review_count is not null
      then lr.review_count - pr.prior_review_count
    else null
  end as reviews_gained_since_prior,
  rc.review_snapshot_count,
  bm.review_velocity_monthly as estimated_monthly_review_velocity_metrics,
  lsp.parent_seo_id,
  lsp.parent_domain,
  lsp.parent_analysis_target,
  lsp.parent_analysis_mode,
  lsp.parent_search_scope,
  lsp.parent_snapshot_date,
  lsp.parent_domain_rating,
  lsp.parent_organic_traffic,
  lsp.parent_organic_keywords,
  lsp.parent_referring_domains,
  lsp.parent_backlinks,
  lsp.parent_traffic_value,
  lsl.local_seo_id,
  lsl.local_analysis_target,
  lsl.local_analysis_mode,
  lsl.local_search_scope,
  lsl.local_location_path,
  lsl.local_snapshot_date,
  lsl.local_domain_rating,
  lsl.local_organic_traffic,
  lsl.local_organic_keywords,
  lsl.local_organic_keywords_top3,
  lsl.local_referring_domains,
  lsl.local_backlinks,
  lsl.local_traffic_value,
  lmr.map_rank_id,
  lmr.provider_scan_id,
  lmr.geogrid_search_term,
  lmr.geogrid_scanned_at,
  lmr.share_of_local_voice,
  lmr.average_grid_rank,
  lmr.average_total_grid_rank,
  lmr.found_in_top_3_count,
  lmr.found_in_top_10_count,
  lmr.total_grid_points,
  lmr.map_rank_status,
  z.population as zip_population,
  z.households as zip_households,
  z.housing_units as zip_housing_units,
  z.owner_occupied_housing_units as zip_owner_occupied_housing_units,
  z.owner_occupied_rate as zip_owner_occupied_rate,
  z.median_household_income as zip_median_household_income,
  z.median_home_value as zip_median_home_value,
  z.median_year_structure_built as zip_median_year_structure_built,
  z.dataset_year as zip_dataset_year,
  greatest(
    lr.review_snapshot_created_at,
    lsp.parent_seo_created_at,
    lsl.local_seo_created_at,
    lmr.map_rank_created_at,
    b.updated_at
  ) as latest_data_refresh_at
from public.businesses b
left join public.markets mk on mk.id = b.market_id
left join normalized_postal np on np.business_id = b.id
left join public.companies c on c.id = b.company_id
left join latest_review lr on lr.business_id = b.id
left join prior_review pr on pr.business_id = b.id
left join review_counts rc on rc.business_id = b.id
left join public.business_metrics bm on bm.business_id = b.id
left join latest_seo_parent lsp on lsp.business_id = b.id
left join latest_seo_local lsl on lsl.business_id = b.id
left join latest_map_rank lmr on lmr.business_id = b.id
left join public.zip_code_stats z on z.zip_code = np.zip_code_normalized;

grant select on public.business_current_signals to anon, authenticated;
