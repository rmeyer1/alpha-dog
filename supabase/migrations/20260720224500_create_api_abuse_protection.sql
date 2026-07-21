create table if not exists public.api_abuse_rate_windows (
  route_key text not null,
  scope_kind text not null,
  scope_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (route_key, scope_kind, scope_key, window_started_at),
  constraint api_abuse_rate_windows_scope_kind_valid
    check (scope_kind in ('ip', 'user')),
  constraint api_abuse_rate_windows_request_count_valid
    check (request_count >= 0)
);

create index if not exists api_abuse_rate_windows_cleanup_idx
  on public.api_abuse_rate_windows (window_started_at);

create table if not exists public.api_abuse_leases (
  lease_id uuid primary key,
  route_key text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists api_abuse_leases_route_expiry_idx
  on public.api_abuse_leases (route_key, expires_at);

create table if not exists public.api_abuse_usage_metrics (
  route_key text not null,
  outcome text not null,
  authenticated boolean not null,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (route_key, outcome, authenticated, window_started_at),
  constraint api_abuse_usage_metrics_outcome_valid
    check (outcome in ('allowed', 'concurrency_limited', 'rate_limited')),
  constraint api_abuse_usage_metrics_request_count_valid
    check (request_count >= 0)
);

create index if not exists api_abuse_usage_metrics_cleanup_idx
  on public.api_abuse_usage_metrics (window_started_at);

alter table public.api_abuse_rate_windows enable row level security;
alter table public.api_abuse_leases enable row level security;
alter table public.api_abuse_usage_metrics enable row level security;

revoke all on public.api_abuse_rate_windows from public, anon, authenticated;
revoke all on public.api_abuse_leases from public, anon, authenticated;
revoke all on public.api_abuse_usage_metrics from public, anon, authenticated;

create or replace function public.acquire_api_abuse_budget(
  p_route_key text,
  p_user_id uuid,
  p_ip_hash text,
  p_window_seconds integer,
  p_user_limit integer,
  p_ip_limit integer,
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
  v_ip_count integer;
  v_metric_window timestamptz;
  v_now timestamptz := clock_timestamp();
  v_retry_after integer;
  v_user_count integer := 0;
  v_window_started_at timestamptz;
begin
  if p_route_key is null or length(p_route_key) < 1 or length(p_route_key) > 100 or
     p_ip_hash is null or length(p_ip_hash) <> 64 or
     p_window_seconds < 1 or p_window_seconds > 86400 or
     p_user_limit < 1 or p_ip_limit < 1 or
     p_concurrency_limit < 1 or p_concurrency_limit > 100 or
     p_lease_seconds < 1 or p_lease_seconds > 900 then
    raise exception 'Invalid API abuse budget configuration.';
  end if;

  -- The critical section is intentionally short and contains no provider work.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('api_abuse:' || p_route_key, 0)
  );

  delete from public.api_abuse_leases
  where route_key = p_route_key and expires_at <= v_now;

  delete from public.api_abuse_rate_windows
  where route_key = p_route_key
    and window_started_at < v_now - interval '2 days';

  delete from public.api_abuse_usage_metrics
  where route_key = p_route_key
    and window_started_at < v_now - interval '90 days';

  v_window_started_at := pg_catalog.to_timestamp(
    pg_catalog.floor(pg_catalog.extract(epoch from v_now) / p_window_seconds) *
    p_window_seconds
  );
  v_metric_window := pg_catalog.date_trunc('minute', v_now);

  select request_count into v_ip_count
  from public.api_abuse_rate_windows
  where route_key = p_route_key
    and scope_kind = 'ip'
    and scope_key = p_ip_hash
    and window_started_at = v_window_started_at;

  if p_user_id is not null then
    select request_count into v_user_count
    from public.api_abuse_rate_windows
    where route_key = p_route_key
      and scope_kind = 'user'
      and scope_key = p_user_id::text
      and window_started_at = v_window_started_at;
  end if;

  if pg_catalog.coalesce(v_ip_count, 0) >= p_ip_limit or
     (p_user_id is not null and pg_catalog.coalesce(v_user_count, 0) >= p_user_limit) then
    v_retry_after := pg_catalog.greatest(
      1,
      pg_catalog.ceil(
        pg_catalog.extract(
          epoch from (v_window_started_at + pg_catalog.make_interval(secs => p_window_seconds) - v_now)
        )
      )::integer
    );

    insert into public.api_abuse_usage_metrics (
      route_key, outcome, authenticated, window_started_at, request_count, updated_at
    ) values (
      p_route_key, 'rate_limited', p_user_id is not null, v_metric_window, 1, v_now
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
  where route_key = p_route_key and expires_at > v_now;

  if v_active_count >= p_concurrency_limit then
    select pg_catalog.greatest(
      1,
      pg_catalog.ceil(pg_catalog.extract(epoch from (min(expires_at) - v_now)))::integer
    ) into v_retry_after
    from public.api_abuse_leases
    where route_key = p_route_key and expires_at > v_now;

    insert into public.api_abuse_usage_metrics (
      route_key, outcome, authenticated, window_started_at, request_count, updated_at
    ) values (
      p_route_key, 'concurrency_limited', p_user_id is not null, v_metric_window, 1, v_now
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
    p_route_key, 'ip', p_ip_hash, v_window_started_at, 1, v_now
  ) on conflict (route_key, scope_kind, scope_key, window_started_at)
    do update set
      request_count = public.api_abuse_rate_windows.request_count + 1,
      updated_at = excluded.updated_at;

  if p_user_id is not null then
    insert into public.api_abuse_rate_windows (
      route_key, scope_kind, scope_key, window_started_at, request_count, updated_at
    ) values (
      p_route_key, 'user', p_user_id::text, v_window_started_at, 1, v_now
    ) on conflict (route_key, scope_kind, scope_key, window_started_at)
      do update set
        request_count = public.api_abuse_rate_windows.request_count + 1,
        updated_at = excluded.updated_at;
  end if;

  insert into public.api_abuse_leases (lease_id, route_key, expires_at)
  values (
    p_lease_id,
    p_route_key,
    v_now + pg_catalog.make_interval(secs => p_lease_seconds)
  );

  insert into public.api_abuse_usage_metrics (
    route_key, outcome, authenticated, window_started_at, request_count, updated_at
  ) values (
    p_route_key, 'allowed', p_user_id is not null, v_metric_window, 1, v_now
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

create or replace function public.release_api_abuse_lease(
  p_route_key text,
  p_lease_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.api_abuse_leases
  where route_key = p_route_key and lease_id = p_lease_id;
$$;

revoke all on function public.acquire_api_abuse_budget(
  text, uuid, text, integer, integer, integer, integer, integer, uuid
) from public, anon, authenticated;
revoke all on function public.release_api_abuse_lease(text, uuid)
  from public, anon, authenticated;

grant execute on function public.acquire_api_abuse_budget(
  text, uuid, text, integer, integer, integer, integer, integer, uuid
) to service_role;
grant execute on function public.release_api_abuse_lease(text, uuid)
  to service_role;
