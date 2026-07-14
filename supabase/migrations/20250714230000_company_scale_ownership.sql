-- Company scale + ownership designations.

alter table public.companies
  add column if not exists company_scale text not null default 'unknown',
  add column if not exists ownership_model text not null default 'unknown',
  add column if not exists location_count integer,
  add column if not exists service_states text[],
  add column if not exists service_markets text[],
  add column if not exists classification_confidence numeric,
  add column if not exists classification_reason text,
  add column if not exists classification_updated_at timestamptz,
  add column if not exists classification_is_manual boolean not null default false;

alter table public.companies
  drop constraint if exists companies_company_scale_check;

alter table public.companies
  add constraint companies_company_scale_check
  check (company_scale in (
    'single_location',
    'multi_location',
    'regional',
    'national',
    'unknown'
  ));

alter table public.companies
  drop constraint if exists companies_ownership_model_check;

alter table public.companies
  add constraint companies_ownership_model_check
  check (ownership_model in (
    'independent',
    'franchise',
    'corporate_chain',
    'unknown'
  ));

create index if not exists companies_company_scale_idx
  on public.companies (company_scale);

create index if not exists companies_ownership_model_idx
  on public.companies (ownership_model);

comment on column public.companies.company_scale is
  'Geographic footprint: single_location | multi_location | regional | national | unknown.';
comment on column public.companies.ownership_model is
  'Ownership: independent | franchise | corporate_chain | unknown.';
comment on column public.companies.classification_is_manual is
  'When true, automated classifiers must not overwrite scale/ownership.';
