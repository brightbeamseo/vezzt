-- Align monitoring tiers with discovery/monitoring split:
-- Tier 1 = weekly (100+), Tier 2 = monthly (<100). Drop tier 3 / quarterly.

alter table public.businesses
  drop constraint if exists businesses_monitoring_tier_check;

alter table public.businesses
  drop constraint if exists businesses_monitoring_frequency_check;

-- Clear obsolete tier 3 / quarterly assignments (will be re-assigned on re-qualify)
update public.businesses
set
  monitoring_tier = case
    when monitoring_tier = 3 then 2
    else monitoring_tier
  end,
  monitoring_frequency = case
    when monitoring_frequency = 'quarterly' then 'monthly'
    else monitoring_frequency
  end
where monitoring_tier = 3
   or monitoring_frequency = 'quarterly';

alter table public.businesses
  add constraint businesses_monitoring_tier_check
  check (monitoring_tier is null or monitoring_tier in (1, 2));

alter table public.businesses
  add constraint businesses_monitoring_frequency_check
  check (
    monitoring_frequency is null
    or monitoring_frequency in ('weekly', 'monthly')
  );

comment on column public.businesses.monitoring_tier is
  '1=weekly (100+ reviews), 2=monthly (<100). Null if not a Roofing contractor.';
comment on column public.businesses.google_place_id is
  'Unique Google Place ID — sole business uniqueness key for collection upserts.';
