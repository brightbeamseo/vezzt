-- Phase VI: mark duplicate LOAs excluded from ranking presentation.

alter table public.local_opportunity_areas
  add column if not exists ranking_excluded boolean not null default false,
  add column if not exists ranking_exclude_reason text,
  add column if not exists duplicate_of_loa_id uuid references public.local_opportunity_areas(id);

comment on column public.local_opportunity_areas.ranking_excluded is
  'True when LOA is a duplicate/near-duplicate and should not be treated as an independent ranking row.';
