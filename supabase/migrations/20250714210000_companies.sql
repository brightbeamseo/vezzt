-- Companies (brand) vs businesses (Google Business Profile locations).

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  root_domain text,
  company_type text not null default 'unknown'
    check (company_type in (
      'independent',
      'franchise',
      'regional',
      'multi_location',
      'unknown'
    )),
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists companies_root_domain_idx
  on public.companies (root_domain)
  where root_domain is not null;

create trigger companies_set_updated_at
before update on public.companies
for each row
execute function public.set_updated_at();

alter table public.companies enable row level security;

create policy "anon_read_companies"
  on public.companies
  for select
  to anon, authenticated
  using (true);

-- Business location fields for company ownership + Ahrefs targeting.

alter table public.businesses
  add column if not exists company_id uuid references public.companies (id),
  add column if not exists analysis_target text,
  add column if not exists analysis_mode text
    check (
      analysis_mode is null
      or analysis_mode in ('domain', 'prefix', 'subdomain', 'exact_url')
    );

create index if not exists businesses_company_id_idx
  on public.businesses (company_id);

comment on table public.companies is
  'Legal/company brand. One company may own many GBP business locations.';
comment on column public.businesses.company_id is
  'Owning company. Google Place ID uniqueness is unchanged.';
comment on column public.businesses.analysis_target is
  'Canonical Ahrefs target (domain, URL prefix, subdomain, or exact URL).';
comment on column public.businesses.analysis_mode is
  'Ahrefs target scope: domain | prefix | subdomain | exact_url.';
