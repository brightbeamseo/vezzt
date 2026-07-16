-- Individual Google review history (Apify Reviews Scraper import).

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'google_apify',
  provider_review_id text not null,
  google_place_id text,
  published_at timestamptz not null,
  rating numeric,
  review_text text,
  reviewer_name text,
  reviewer_url text,
  owner_response_text text,
  owner_response_date timestamptz,
  raw_response jsonb,
  imported_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_review_id)
);

create index if not exists reviews_business_published_at_idx
  on public.reviews (business_id, published_at);

create index if not exists reviews_business_rating_idx
  on public.reviews (business_id, rating);

create index if not exists reviews_owner_response_date_idx
  on public.reviews (owner_response_date);

alter table public.reviews enable row level security;

drop policy if exists "anon_read_reviews" on public.reviews;
create policy "anon_read_reviews"
  on public.reviews
  for select
  to anon, authenticated
  using (true);

grant select on public.reviews to anon, authenticated;

comment on table public.reviews is
  'Individual Google review rows imported via Apify (one row per review).';

-- Monthly aggregation view (not permanently stored derived rows).
drop view if exists public.review_monthly_stats;

create view public.review_monthly_stats
with (security_invoker = true)
as
with monthly as (
  select
    r.business_id,
    date_trunc('month', r.published_at)::date as month,
    count(*)::int as reviews_received,
    avg(r.rating)::numeric as average_rating,
    count(*) filter (
      where r.owner_response_text is not null
        and length(trim(r.owner_response_text)) > 0
    )::int as responses_count
  from public.reviews r
  group by r.business_id, date_trunc('month', r.published_at)::date
),
ordered as (
  select
    m.*,
    sum(m.reviews_received) over (
      partition by m.business_id
      order by m.month
      rows between unbounded preceding and current row
    )::int as cumulative_review_count
  from monthly m
)
select
  business_id,
  month,
  reviews_received,
  average_rating,
  cumulative_review_count,
  responses_count,
  case
    when reviews_received > 0
      then (responses_count::numeric / reviews_received::numeric)
    else null
  end as response_rate
from ordered
order by business_id, month;

grant select on public.review_monthly_stats to anon, authenticated;

comment on view public.review_monthly_stats is
  'One row per business per calendar month of imported review history.';
