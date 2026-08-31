-- Phase V: Roofing Expansion Opportunity Score storage.

create table if not exists public.loa_opportunity_scores (
  loa_id uuid primary key references public.local_opportunity_areas(id) on delete cascade,
  eligible boolean not null default false,
  eligibility_reason text,
  model text not null default 'baseline'
    check (model in ('baseline', 'market_heavy', 'competition_heavy')),
  rank integer,
  opportunity_score numeric,
  -- component scores 0–100
  score_owner_hh numeric,
  score_income numeric,
  score_housing_growth numeric,
  score_primary_scarcity numeric,
  score_established_scarcity numeric,
  score_incumbent_strength numeric,
  -- raw inputs used
  owner_occupied_households integer,
  median_household_income numeric,
  housing_growth numeric,
  primary_in_radius integer,
  owner_hh_per_primary numeric,
  reviews_100_plus integer,
  owner_hh_per_100_plus numeric,
  top5_reviews_avg numeric,
  secondary_risk_flag boolean not null default false,
  cluster_id text,
  cluster_name text,
  cluster_center boolean not null default false,
  computed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (loa_id, model)
);

-- Allow multiple models per LOA
alter table public.loa_opportunity_scores drop constraint if exists loa_opportunity_scores_pkey;
alter table public.loa_opportunity_scores
  add primary key (loa_id, model);

create index if not exists loa_opportunity_scores_rank_idx
  on public.loa_opportunity_scores (model, rank nulls last);

alter table public.loa_opportunity_scores enable row level security;

drop policy if exists "anon_read_loa_opportunity_scores" on public.loa_opportunity_scores;
create policy "anon_read_loa_opportunity_scores"
  on public.loa_opportunity_scores for select to anon, authenticated using (true);

grant select on public.loa_opportunity_scores to anon, authenticated;

comment on table public.loa_opportunity_scores is
  'Roofing Expansion Opportunity Score (0–100). Not a Vestimate or revenue estimate.';
