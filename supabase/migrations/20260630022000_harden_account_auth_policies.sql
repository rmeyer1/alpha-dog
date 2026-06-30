create or replace function public.normalize_account_email(email text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(btrim(email));
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop policy if exists "Users can read their own account profile"
  on public.account_profiles;
drop policy if exists "Users can create their own account profile"
  on public.account_profiles;
drop policy if exists "Users can update their own account profile"
  on public.account_profiles;
drop policy if exists "Users can delete their own account profile"
  on public.account_profiles;

create policy "Users can read their own account profile"
  on public.account_profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can create their own account profile"
  on public.account_profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own account profile"
  on public.account_profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can delete their own account profile"
  on public.account_profiles
  for delete
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "Users can read their own account identities"
  on public.account_identities;
drop policy if exists "Users can create their own account identities"
  on public.account_identities;
drop policy if exists "Users can update their own account identities"
  on public.account_identities;
drop policy if exists "Users can delete their own account identities"
  on public.account_identities;

create policy "Users can read their own account identities"
  on public.account_identities
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own account identities"
  on public.account_identities
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own account identities"
  on public.account_identities
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own account identities"
  on public.account_identities
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own saved presets"
  on public.saved_presets;
drop policy if exists "Users can create their own saved presets"
  on public.saved_presets;
drop policy if exists "Users can update their own saved presets"
  on public.saved_presets;
drop policy if exists "Users can delete their own saved presets"
  on public.saved_presets;

create policy "Users can read their own saved presets"
  on public.saved_presets
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own saved presets"
  on public.saved_presets
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own saved presets"
  on public.saved_presets
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own saved presets"
  on public.saved_presets
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own analysis requests"
  on public.analysis_requests;
drop policy if exists "Users can create their own analysis requests"
  on public.analysis_requests;
drop policy if exists "Users can update their own analysis requests"
  on public.analysis_requests;
drop policy if exists "Users can delete their own analysis requests"
  on public.analysis_requests;

create policy "Users can read their own analysis requests"
  on public.analysis_requests
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own analysis requests"
  on public.analysis_requests
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own analysis requests"
  on public.analysis_requests
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own analysis requests"
  on public.analysis_requests
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
