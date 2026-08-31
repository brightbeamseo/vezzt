-- Phase IV: allow corrected demographic quality flag + provenance fields.

alter table public.local_opportunity_areas
  drop constraint if exists local_opportunity_areas_demo_quality_flag_check;

alter table public.local_opportunity_areas
  add constraint local_opportunity_areas_demo_quality_flag_check
  check (
    demo_quality_flag is null
    or demo_quality_flag in ('ok', 'review', 'incomplete', 'corrected')
  );

alter table public.local_opportunity_areas
  add column if not exists demo_corrected boolean not null default false,
  add column if not exists demo_correction_method text,
  add column if not exists demo_pre_correction jsonb;

comment on column public.local_opportunity_areas.demo_corrected is
  'True when Phase IV applied a targeted ZCTA correction (not global methodology change).';
comment on column public.local_opportunity_areas.demo_correction_method is
  'soft_intersect_15mi | manual_local_zcta | etc.';
