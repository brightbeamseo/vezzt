-- Business qualification fields for sector filtering (roofing MVP).
-- Excluded businesses are retained; status marks inclusion for the main dataset.

alter table public.businesses
  add column if not exists is_qualified boolean not null default false,
  add column if not exists qualification_reason text,
  add column if not exists qualification_confidence numeric,
  add column if not exists target_sector text,
  add column if not exists review_threshold_met boolean not null default false,
  add column if not exists qualification_status text not null default 'excluded'
    check (
      qualification_status in (
        'qualified',
        'below_threshold',
        'excluded',
        'manual_review'
      )
    );

create index if not exists businesses_qualification_status_idx
  on public.businesses (qualification_status);

create index if not exists businesses_target_sector_idx
  on public.businesses (target_sector);

create index if not exists businesses_is_qualified_idx
  on public.businesses (is_qualified)
  where is_qualified = true;

comment on column public.businesses.is_qualified is
  'True only when qualification_status = qualified (sector match + review threshold).';
comment on column public.businesses.qualification_status is
  'qualified | below_threshold | excluded | manual_review';
comment on column public.businesses.target_sector is
  'Intended vertical when matched (e.g. roofing), even if below threshold.';
