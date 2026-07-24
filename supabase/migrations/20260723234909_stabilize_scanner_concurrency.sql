create table if not exists public.wheel_scan_leases (
  lease_key text primary key,
  owner_id uuid not null,
  scan_kind text not null,
  context_key text not null,
  interval_started_at timestamptz not null,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint wheel_scan_leases_scan_kind_valid
    check (scan_kind in ('universe', 'deep_scan')),
  constraint wheel_scan_leases_key_length_valid
    check (length(lease_key) between 1 and 200),
  constraint wheel_scan_leases_context_length_valid
    check (length(context_key) between 1 and 500)
);

create index if not exists wheel_scan_leases_expiry_idx
  on public.wheel_scan_leases (expires_at);

alter table public.wheel_scan_leases enable row level security;

revoke all on public.wheel_scan_leases from public, anon, authenticated;
grant select, insert, update, delete on public.wheel_scan_leases to service_role;

create or replace function public.acquire_wheel_scan_lease(
  p_lease_key text,
  p_owner_id uuid,
  p_scan_kind text,
  p_context_key text,
  p_interval_started_at timestamptz,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current public.wheel_scan_leases%rowtype;
  v_expires_at timestamptz;
  v_has_current boolean;
  v_now timestamptz := clock_timestamp();
  v_retry_after integer;
begin
  if p_lease_key is null or length(p_lease_key) < 1 or length(p_lease_key) > 200 or
     p_owner_id is null or
     p_scan_kind not in ('universe', 'deep_scan') or
     p_context_key is null or length(p_context_key) < 1 or length(p_context_key) > 500 or
     p_interval_started_at is null or
     p_lease_seconds < 30 or p_lease_seconds > 7200 then
    raise exception 'Invalid wheel scan lease configuration.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wheel_scan:' || p_lease_key, 0)
  );

  select *
  into v_current
  from public.wheel_scan_leases
  where lease_key = p_lease_key;

  v_has_current := found;
  v_expires_at :=
    v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  if not v_has_current then
    insert into public.wheel_scan_leases (
      lease_key,
      owner_id,
      scan_kind,
      context_key,
      interval_started_at,
      acquired_at,
      heartbeat_at,
      expires_at
    ) values (
      p_lease_key,
      p_owner_id,
      p_scan_kind,
      p_context_key,
      p_interval_started_at,
      v_now,
      v_now,
      v_expires_at
    );

    return pg_catalog.jsonb_build_object(
      'acquired', true,
      'owner_id', p_owner_id,
      'expires_at', v_expires_at,
      'retry_after_seconds', 0
    );
  end if;

  if v_current.owner_id = p_owner_id or v_current.expires_at <= v_now then
    update public.wheel_scan_leases
    set
      owner_id = p_owner_id,
      scan_kind = p_scan_kind,
      context_key = p_context_key,
      interval_started_at = p_interval_started_at,
      acquired_at = case
        when v_current.owner_id = p_owner_id then acquired_at
        else v_now
      end,
      heartbeat_at = v_now,
      expires_at = v_expires_at
    where lease_key = p_lease_key;

    return pg_catalog.jsonb_build_object(
      'acquired', true,
      'owner_id', p_owner_id,
      'expires_at', v_expires_at,
      'retry_after_seconds', 0
    );
  end if;

  v_retry_after := greatest(
    1,
    pg_catalog.ceil(
      extract(epoch from (v_current.expires_at - v_now))
    )::integer
  );

  return pg_catalog.jsonb_build_object(
    'acquired', false,
    'owner_id', v_current.owner_id,
    'expires_at', v_current.expires_at,
    'retry_after_seconds', v_retry_after
  );
end;
$$;

create or replace function public.heartbeat_wheel_scan_lease(
  p_lease_key text,
  p_owner_id uuid,
  p_lease_seconds integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expires_at timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_lease_key is null or length(p_lease_key) < 1 or length(p_lease_key) > 200 or
     p_owner_id is null or
     p_lease_seconds < 30 or p_lease_seconds > 7200 then
    raise exception 'Invalid wheel scan lease heartbeat.';
  end if;

  v_expires_at :=
    v_now + pg_catalog.make_interval(secs => p_lease_seconds);

  update public.wheel_scan_leases
  set heartbeat_at = v_now, expires_at = v_expires_at
  where lease_key = p_lease_key
    and owner_id = p_owner_id
    and expires_at > v_now;

  if not found then
    return pg_catalog.jsonb_build_object('renewed', false);
  end if;

  return pg_catalog.jsonb_build_object(
    'renewed', true,
    'expires_at', v_expires_at
  );
end;
$$;

create or replace function public.release_wheel_scan_lease(
  p_lease_key text,
  p_owner_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.wheel_scan_leases
  where lease_key = p_lease_key and owner_id = p_owner_id;

  return found;
end;
$$;

revoke all on function public.acquire_wheel_scan_lease(
  text, uuid, text, text, timestamptz, integer
) from public, anon, authenticated;
revoke all on function public.heartbeat_wheel_scan_lease(
  text, uuid, integer
) from public, anon, authenticated;
revoke all on function public.release_wheel_scan_lease(
  text, uuid
) from public, anon, authenticated;

grant execute on function public.acquire_wheel_scan_lease(
  text, uuid, text, text, timestamptz, integer
) to service_role;
grant execute on function public.heartbeat_wheel_scan_lease(
  text, uuid, integer
) to service_role;
grant execute on function public.release_wheel_scan_lease(
  text, uuid
) to service_role;

alter table public.wheel_universe_scan_runs
  add column if not exists heartbeat_at timestamptz not null default now(),
  add column if not exists lease_key text,
  add column if not exists lease_owner_id uuid;

alter table public.wheel_deep_scan_runs
  add column if not exists heartbeat_at timestamptz not null default now(),
  add column if not exists lease_key text,
  add column if not exists lease_owner_id uuid,
  add column if not exists workflow_result jsonb;

create index if not exists wheel_universe_scan_runs_running_heartbeat_idx
  on public.wheel_universe_scan_runs (status, heartbeat_at)
  where status = 'running';

create index if not exists wheel_deep_scan_runs_running_heartbeat_idx
  on public.wheel_deep_scan_runs (status, heartbeat_at)
  where status = 'running';

create index if not exists wheel_deep_scan_candidates_scan_run_idx
  on public.wheel_deep_scan_candidates (scan_run_id);

create index if not exists wheel_deep_scan_coverage_scan_run_idx
  on public.wheel_deep_scan_coverage (scan_run_id);
