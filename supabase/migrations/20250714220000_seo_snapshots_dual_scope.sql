-- Dual-scope Ahrefs SEO snapshots: company_domain + business_location.

alter table public.seo_snapshots
  add column if not exists scope text,
  add column if not exists analysis_target text,
  add column if not exists analysis_mode text,
  add column if not exists parent_domain text,
  add column if not exists location_path text;

-- Backfill existing rows as single company-domain snapshots.
update public.seo_snapshots
set
  scope = coalesce(scope, 'company_domain'),
  analysis_target = coalesce(nullif(analysis_target, ''), domain),
  analysis_mode = coalesce(analysis_mode, 'domain'),
  parent_domain = coalesce(parent_domain, domain)
where scope is null
   or analysis_target is null
   or analysis_mode is null;

-- Deduplicate same-day parent pulls so the unique key can be added.
delete from public.seo_snapshots s
using public.seo_snapshots newer
where s.business_id = newer.business_id
  and s.provider = newer.provider
  and s.snapshot_date = newer.snapshot_date
  and coalesce(s.scope, 'company_domain') = coalesce(newer.scope, 'company_domain')
  and coalesce(s.analysis_target, s.domain) = coalesce(newer.analysis_target, newer.domain)
  and coalesce(s.analysis_mode, 'domain') = coalesce(newer.analysis_mode, 'domain')
  and s.created_at < newer.created_at;

alter table public.seo_snapshots
  alter column scope set not null,
  alter column analysis_target set not null,
  alter column analysis_mode set not null;

alter table public.seo_snapshots
  drop constraint if exists seo_snapshots_scope_check;

alter table public.seo_snapshots
  add constraint seo_snapshots_scope_check
  check (scope in ('company_domain', 'business_location'));

alter table public.seo_snapshots
  drop constraint if exists seo_snapshots_analysis_mode_check;

alter table public.seo_snapshots
  add constraint seo_snapshots_analysis_mode_check
  check (analysis_mode in ('domain', 'prefix', 'subdomain', 'exact_url'));

create unique index if not exists seo_snapshots_unique_scope_target_idx
  on public.seo_snapshots (
    business_id,
    provider,
    snapshot_date,
    scope,
    analysis_target,
    analysis_mode
  );

create index if not exists seo_snapshots_parent_domain_date_idx
  on public.seo_snapshots (parent_domain, snapshot_date)
  where scope = 'company_domain';

comment on column public.seo_snapshots.scope is
  'company_domain = parent brand metrics; business_location = path/subdomain metrics.';
comment on column public.seo_snapshots.analysis_target is
  'Exact Ahrefs target used for this pull.';
comment on column public.seo_snapshots.analysis_mode is
  'Ahrefs mode: domain | prefix | subdomain | exact_url.';
comment on column public.seo_snapshots.parent_domain is
  'Registrable parent domain (e.g. mightydogroofing.com).';
comment on column public.seo_snapshots.location_path is
  'Location path when scope=business_location and mode=prefix (e.g. /boise-id/).';
