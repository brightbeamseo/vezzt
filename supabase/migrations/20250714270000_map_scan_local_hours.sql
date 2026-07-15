-- Market timezone + LBM GeoGrid local-hours scheduling.

create table if not exists public.markets (
  id text primary key,
  name text not null,
  timezone text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.markets (id, name, timezone)
values ('boise-metro', 'Boise Metro', 'America/Boise')
on conflict (id) do update set
  name = excluded.name,
  timezone = excluded.timezone,
  updated_at = now();

alter table public.markets enable row level security;

drop policy if exists "anon_read_markets" on public.markets;
create policy "anon_read_markets"
  on public.markets
  for select
  to anon, authenticated
  using (true);

grant select on public.markets to anon, authenticated;

alter table public.businesses
  add column if not exists timezone text,
  add column if not exists map_scan_timezone text,
  add column if not exists map_scan_next_eligible_at timestamptz,
  add column if not exists map_scan_last_requested_at timestamptz,
  add column if not exists map_scan_local_time text,
  add column if not exists map_scan_schedule_status text,
  add column if not exists map_scan_wait_reason text;

alter table public.businesses
  drop constraint if exists businesses_map_scan_schedule_status_check;

alter table public.businesses
  add constraint businesses_map_scan_schedule_status_check
  check (
    map_scan_schedule_status is null
    or map_scan_schedule_status in (
      'eligible',
      'waiting_for_window',
      'submitted',
      'pending',
      'finished',
      'failed',
      'timezone_missing'
    )
  );

-- Backfill Boise Metro businesses from market timezone.
update public.businesses b
set
  timezone = coalesce(nullif(b.timezone, ''), m.timezone),
  map_scan_timezone = coalesce(nullif(b.map_scan_timezone, ''), m.timezone),
  updated_at = now()
from public.markets m
where m.id = b.market_id
  and m.id = 'boise-metro';

alter table public.map_rank_snapshots
  add column if not exists location_timezone text,
  add column if not exists requested_at_utc timestamptz,
  add column if not exists requested_at_local text,
  add column if not exists local_weekday text,
  add column if not exists local_hour integer,
  add column if not exists schedule_rule_version text;

comment on column public.businesses.timezone is
  'IANA timezone for the business location (e.g. America/Boise).';
comment on column public.businesses.map_scan_schedule_status is
  'LBM GeoGrid schedule state: eligible | waiting_for_window | submitted | pending | finished | failed | timezone_missing';
comment on column public.map_rank_snapshots.schedule_rule_version is
  'Policy version used when the scan was requested (weekday 10:00–16:00 local).';
