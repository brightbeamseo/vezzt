-- Scope businesses and scrape runs to exactly one market.

alter table public.businesses
  add column if not exists market_id text;

alter table public.scrape_runs
  add column if not exists market_id text;

create index if not exists businesses_market_id_idx
  on public.businesses (market_id);

create index if not exists scrape_runs_market_id_idx
  on public.scrape_runs (market_id);

comment on column public.businesses.market_id is
  'Market this business was collected into (e.g. boise-metro).';
comment on column public.scrape_runs.market_id is
  'Market this scrape job targeted. Every job belongs to exactly one market.';
