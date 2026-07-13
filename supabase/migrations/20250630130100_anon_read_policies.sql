-- Allow server-side demo reads via the publishable (anon) key.
-- Write access remains blocked until explicit policies are added.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'businesses'
      and policyname = 'Allow anon read on businesses'
  ) then
    create policy "Allow anon read on businesses"
      on public.businesses for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_metrics'
      and policyname = 'Allow anon read on business_metrics'
  ) then
    create policy "Allow anon read on business_metrics"
      on public.business_metrics for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'business_enrichment'
      and policyname = 'Allow anon read on business_enrichment'
  ) then
    create policy "Allow anon read on business_enrichment"
      on public.business_enrichment for select to anon, authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'review_snapshots'
      and policyname = 'Allow anon read on review_snapshots'
  ) then
    create policy "Allow anon read on review_snapshots"
      on public.review_snapshots for select to anon, authenticated using (true);
  end if;
end $$;
