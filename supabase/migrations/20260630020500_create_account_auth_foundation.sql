create or replace function public.normalize_account_email(email text)
returns text
language sql
immutable
parallel safe
as $$
  select lower(btrim(email));
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.account_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  normalized_email text generated always as (public.normalize_account_email(email)) stored,
  first_name text not null,
  last_name text not null,
  display_name text,
  primary_provider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_profiles_email_not_blank check (public.normalize_account_email(email) <> ''),
  constraint account_profiles_first_name_not_blank check (btrim(first_name) <> ''),
  constraint account_profiles_last_name_not_blank check (btrim(last_name) <> ''),
  constraint account_profiles_normalized_email_unique unique (normalized_email)
);

create trigger account_profiles_set_updated_at
  before update on public.account_profiles
  for each row
  execute function public.set_updated_at();

alter table public.account_profiles enable row level security;

create policy "Users can read their own account profile"
  on public.account_profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "Users can create their own account profile"
  on public.account_profiles
  for insert
  to authenticated
  with check (auth.uid() = id);

create policy "Users can update their own account profile"
  on public.account_profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users can delete their own account profile"
  on public.account_profiles
  for delete
  to authenticated
  using (auth.uid() = id);

create table if not exists public.account_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  provider_email text,
  normalized_provider_email text generated always as (
    case
      when provider_email is null then null
      else public.normalize_account_email(provider_email)
    end
  ) stored,
  created_at timestamptz not null default now(),
  constraint account_identities_provider_not_blank check (btrim(provider) <> ''),
  constraint account_identities_provider_user_id_not_blank check (btrim(provider_user_id) <> ''),
  constraint account_identities_provider_user_unique unique (provider, provider_user_id)
);

create index if not exists account_identities_user_idx
  on public.account_identities (user_id, provider);

alter table public.account_identities enable row level security;

create policy "Users can read their own account identities"
  on public.account_identities
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own account identities"
  on public.account_identities
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own account identities"
  on public.account_identities
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own account identities"
  on public.account_identities
  for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.saved_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  name text not null,
  base_persona_id text not null,
  filters jsonb not null default '{}'::jsonb,
  scoring_overrides jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_presets_name_not_blank check (btrim(name) <> ''),
  constraint saved_presets_base_persona_not_blank check (btrim(base_persona_id) <> '')
);

create index if not exists saved_presets_user_updated_idx
  on public.saved_presets (user_id, updated_at desc);

create trigger saved_presets_set_updated_at
  before update on public.saved_presets
  for each row
  execute function public.set_updated_at();

alter table public.saved_presets enable row level security;

create policy "Users can read their own saved presets"
  on public.saved_presets
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own saved presets"
  on public.saved_presets
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own saved presets"
  on public.saved_presets
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own saved presets"
  on public.saved_presets
  for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.analysis_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  ticker text not null,
  persona_id text not null,
  filters jsonb not null default '{}'::jsonb,
  feed text,
  cache_status text,
  requested_at timestamptz not null default now(),
  constraint analysis_requests_ticker_not_blank check (btrim(ticker) <> ''),
  constraint analysis_requests_persona_not_blank check (btrim(persona_id) <> '')
);

create index if not exists analysis_requests_user_requested_idx
  on public.analysis_requests (user_id, requested_at desc);

alter table public.analysis_requests enable row level security;

create policy "Users can read their own analysis requests"
  on public.analysis_requests
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can create their own analysis requests"
  on public.analysis_requests
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own analysis requests"
  on public.analysis_requests
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own analysis requests"
  on public.analysis_requests
  for delete
  to authenticated
  using (auth.uid() = user_id);
