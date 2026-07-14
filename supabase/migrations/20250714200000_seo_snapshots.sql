-- Historical Ahrefs SEO summary snapshots (one row per fetch; never overwrite).

create table if not exists public.seo_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  provider text not null default 'ahrefs',
  domain text not null,
  snapshot_date date not null,
  domain_rating numeric,
  referring_domains integer,
  backlinks integer,
  organic_traffic integer,
  organic_keywords integer,
  organic_keywords_top3 integer,
  traffic_value numeric,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists seo_snapshots_business_id_snapshot_date_idx
  on public.seo_snapshots (business_id, snapshot_date desc);

alter table public.seo_snapshots enable row level security;

create policy "anon_read_seo_snapshots"
  on public.seo_snapshots
  for select
  to anon, authenticated
  using (true);

comment on table public.seo_snapshots is
  'Historical SEO summary metrics from Ahrefs (and future providers). Append-only.';
