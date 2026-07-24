alter table public.api_abuse_rate_windows
  drop constraint if exists api_abuse_rate_windows_scope_kind_valid;

alter table public.api_abuse_rate_windows
  add constraint api_abuse_rate_windows_scope_kind_valid
  check (scope_kind in ('ip', 'user', 'email'));

-- COALESCE and GREATEST are SQL expressions rather than ordinary pg_catalog
-- functions. Repair the already-created general limiter in environments that
-- applied the preceding migration before its source was corrected.
do $$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.acquire_api_abuse_budget(text,uuid,text,integer,integer,integer,integer,integer,uuid)'::regprocedure
  ) into v_definition;

  v_definition := pg_catalog.replace(
    v_definition,
    'pg_catalog.coalesce',
    'coalesce'
  );
  v_definition := pg_catalog.replace(
    v_definition,
    'pg_catalog.greatest',
    'greatest'
  );

  execute v_definition;
end;
$$;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create or replace function private.create_manual_account_invite_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first_name text := pg_catalog.btrim(new.raw_user_meta_data ->> 'first_name');
  v_last_name text := pg_catalog.btrim(new.raw_user_meta_data ->> 'last_name');
begin
  if new.email is null or pg_catalog.btrim(new.email) = '' or
     v_first_name is null or v_first_name = '' or
     v_last_name is null or v_last_name = '' then
    raise exception 'Manual account invite metadata is incomplete.'
      using errcode = 'check_violation';
  end if;

  insert into public.account_profiles (
    id,
    email,
    first_name,
    last_name,
    display_name,
    primary_provider
  ) values (
    new.id,
    new.email,
    v_first_name,
    v_last_name,
    v_first_name || ' ' || v_last_name,
    'email'
  );

  return new;
end;
$$;

revoke all on function private.create_manual_account_invite_profile()
  from public, anon, authenticated, service_role;

drop trigger if exists create_manual_account_invite_profile
  on auth.users;

create trigger create_manual_account_invite_profile
  after insert on auth.users
  for each row
  when (
    coalesce(new.raw_user_meta_data ->> 'manual_account_invite', 'false') = 'true'
  )
  execute function private.create_manual_account_invite_profile();

create or replace function public.acquire_manual_account_invite_budget(
  p_ip_hash text,
  p_email_hash text,
  p_ip_window_seconds integer,
  p_email_window_seconds integer,
  p_ip_limit integer,
  p_email_limit integer,
  p_concurrency_limit integer,
  p_lease_seconds integer,
  p_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count integer;
  v_email_count integer;
  v_email_window_started_at timestamptz;
  v_ip_count integer;
  v_ip_window_started_at timestamptz;
  v_metric_window timestamptz;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_retry_after integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 or
     p_email_hash is null or length(p_email_hash) <> 64 or
     p_ip_window_seconds < 1 or p_ip_window_seconds > 86400 or
     p_email_window_seconds < 1 or p_email_window_seconds > 604800 or
     p_ip_limit < 1 or p_email_limit < 1 or
     p_concurrency_limit < 1 or p_concurrency_limit > 100 or
     p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'Invalid manual account invitation budget configuration.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('api_abuse:auth.manual_account', 0)
  );

  delete from public.api_abuse_leases
  where route_key = 'auth.manual_account' and expires_at <= v_now;

  delete from public.api_abuse_rate_windows
  where route_key = 'auth.manual_account'
    and window_started_at < v_now - interval '8 days';

  delete from public.api_abuse_usage_metrics
  where route_key = 'auth.manual_account'
    and window_started_at < v_now - interval '90 days';

  v_ip_window_started_at := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from v_now) / p_ip_window_seconds) *
    p_ip_window_seconds
  );
  v_email_window_started_at := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from v_now) / p_email_window_seconds) *
    p_email_window_seconds
  );
  v_metric_window := pg_catalog.date_trunc('minute', v_now);

  select request_count into v_ip_count
  from public.api_abuse_rate_windows
  where route_key = 'auth.manual_account'
    and scope_kind = 'ip'
    and scope_key = p_ip_hash
    and window_started_at = v_ip_window_started_at;

  select request_count into v_email_count
  from public.api_abuse_rate_windows
  where route_key = 'auth.manual_account'
    and scope_kind = 'email'
    and scope_key = p_email_hash
    and window_started_at = v_email_window_started_at;

  if coalesce(v_ip_count, 0) >= p_ip_limit or
     coalesce(v_email_count, 0) >= p_email_limit then
    v_retry_after := greatest(
      1,
      pg_catalog.ceil(extract(epoch from (
        greatest(
          v_ip_window_started_at + pg_catalog.make_interval(secs => p_ip_window_seconds),
          v_email_window_started_at + pg_catalog.make_interval(secs => p_email_window_seconds)
        ) - v_now
      )))::integer
    );

    insert into public.api_abuse_usage_metrics (
      route_key, outcome, authenticated, window_started_at, request_count, updated_at
    ) values (
      'auth.manual_account', 'rate_limited', false, v_metric_window, 1, v_now
    ) on conflict (route_key, outcome, authenticated, window_started_at)
      do update set
        request_count = public.api_abuse_usage_metrics.request_count + 1,
        updated_at = excluded.updated_at;

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'rate',
      'retry_after_seconds', v_retry_after
    );
  end if;

  select count(*)::integer into v_active_count
  from public.api_abuse_leases
  where route_key = 'auth.manual_account' and expires_at > v_now;

  if v_active_count >= p_concurrency_limit then
    select greatest(
      1,
      pg_catalog.ceil(extract(epoch from (min(expires_at) - v_now)))::integer
    ) into v_retry_after
    from public.api_abuse_leases
    where route_key = 'auth.manual_account' and expires_at > v_now;

    insert into public.api_abuse_usage_metrics (
      route_key, outcome, authenticated, window_started_at, request_count, updated_at
    ) values (
      'auth.manual_account', 'concurrency_limited', false, v_metric_window, 1, v_now
    ) on conflict (route_key, outcome, authenticated, window_started_at)
      do update set
        request_count = public.api_abuse_usage_metrics.request_count + 1,
        updated_at = excluded.updated_at;

    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'concurrency',
      'retry_after_seconds', v_retry_after
    );
  end if;

  insert into public.api_abuse_rate_windows (
    route_key, scope_kind, scope_key, window_started_at, request_count, updated_at
  ) values (
    'auth.manual_account', 'ip', p_ip_hash, v_ip_window_started_at, 1, v_now
  ) on conflict (route_key, scope_kind, scope_key, window_started_at)
    do update set
      request_count = public.api_abuse_rate_windows.request_count + 1,
      updated_at = excluded.updated_at;

  insert into public.api_abuse_rate_windows (
    route_key, scope_kind, scope_key, window_started_at, request_count, updated_at
  ) values (
    'auth.manual_account', 'email', p_email_hash, v_email_window_started_at, 1, v_now
  ) on conflict (route_key, scope_kind, scope_key, window_started_at)
    do update set
      request_count = public.api_abuse_rate_windows.request_count + 1,
      updated_at = excluded.updated_at;

  insert into public.api_abuse_leases (lease_id, route_key, expires_at)
  values (
    p_lease_id,
    'auth.manual_account',
    v_now + pg_catalog.make_interval(secs => p_lease_seconds)
  );

  insert into public.api_abuse_usage_metrics (
    route_key, outcome, authenticated, window_started_at, request_count, updated_at
  ) values (
    'auth.manual_account', 'allowed', false, v_metric_window, 1, v_now
  ) on conflict (route_key, outcome, authenticated, window_started_at)
    do update set
      request_count = public.api_abuse_usage_metrics.request_count + 1,
      updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'lease_id', p_lease_id,
    'retry_after_seconds', 0
  );
end;
$$;

revoke all on function public.acquire_manual_account_invite_budget(
  text, text, integer, integer, integer, integer, integer, integer, uuid
) from public, anon, authenticated;

grant execute on function public.acquire_manual_account_invite_budget(
  text, text, integer, integer, integer, integer, integer, integer, uuid
) to service_role;
