-- Ahrefs geographic/business search scope on SEO snapshots.

alter table public.seo_snapshots
  add column if not exists search_scope text not null default 'unknown';

alter table public.seo_snapshots
  drop constraint if exists seo_snapshots_search_scope_check;

alter table public.seo_snapshots
  add constraint seo_snapshots_search_scope_check
  check (search_scope in ('location', 'company', 'mixed', 'unknown'));

create index if not exists seo_snapshots_search_scope_idx
  on public.seo_snapshots (search_scope);

comment on column public.seo_snapshots.search_scope is
  'Geographic/business interpretation of Ahrefs metrics: location | company | mixed | unknown';

-- Recreate flattened view (column set changed — drop first).
drop view if exists public.business_current_signals;

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
)
select
  b.id as business_id,
  b.name as business_name,
  b.city,
  b.state,
  b.website_url,
  b.google_maps_url,
  b.google_place_id,
  b.primary_category,
  b.target_sector,
  b.qualification_status,
  b.is_qualified,
  b.market_id,
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
  greatest(
    lr.review_snapshot_created_at,
    lsp.parent_seo_created_at,
    lsl.local_seo_created_at,
    lmr.map_rank_created_at,
    b.updated_at
  ) as latest_data_refresh_at
from public.businesses b
left join public.companies c on c.id = b.company_id
left join latest_review lr on lr.business_id = b.id
left join prior_review pr on pr.business_id = b.id
left join review_counts rc on rc.business_id = b.id
left join public.business_metrics bm on bm.business_id = b.id
left join latest_seo_parent lsp on lsp.business_id = b.id
left join latest_seo_local lsl on lsl.business_id = b.id
left join latest_map_rank lmr on lmr.business_id = b.id;

grant select on public.business_current_signals to anon, authenticated;
