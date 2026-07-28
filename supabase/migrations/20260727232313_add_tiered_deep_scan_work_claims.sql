alter table public.wheel_underlying_universe force row level security;
alter table public.wheel_underlying_snapshots force row level security;
alter table public.wheel_deep_scan_candidates force row level security;
alter table public.wheel_deep_scan_coverage force row level security;

revoke all on public.wheel_underlying_universe
  from public, anon, authenticated;
revoke all on public.wheel_underlying_snapshots
  from public, anon, authenticated;
revoke all on public.wheel_deep_scan_candidates
  from public, anon, authenticated;
revoke all on public.wheel_deep_scan_coverage
  from public, anon, authenticated;

grant select, insert, update, delete on public.wheel_underlying_universe
  to service_role;
grant select, insert, update, delete on public.wheel_underlying_snapshots
  to service_role;
grant select, insert, update, delete on public.wheel_deep_scan_candidates
  to service_role;
grant select, insert, update, delete on public.wheel_deep_scan_coverage
  to service_role;

create table if not exists public.wheel_deep_scan_tiers (
  tier text primary key,
  priority smallint not null unique,
  rank_start integer not null,
  rank_end integer,
  freshness_seconds integer not null,
  provider_backoff_base_seconds integer not null default 300,
  provider_backoff_max_seconds integer not null default 21600,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint wheel_deep_scan_tiers_name_valid
    check (tier in ('priority', 'daily', 'weekly')),
  constraint wheel_deep_scan_tiers_priority_valid
    check (priority between 1 and 100),
  constraint wheel_deep_scan_tiers_rank_valid
    check (
      rank_start >= 1 and
      (rank_end is null or rank_end >= rank_start)
    ),
  constraint wheel_deep_scan_tiers_freshness_valid
    check (freshness_seconds between 60 and 2592000),
  constraint wheel_deep_scan_tiers_backoff_valid
    check (
      provider_backoff_base_seconds between 30 and 86400 and
      provider_backoff_max_seconds >= provider_backoff_base_seconds and
      provider_backoff_max_seconds <= 604800
    )
);

insert into public.wheel_deep_scan_tiers (
  tier,
  priority,
  rank_start,
  rank_end,
  freshness_seconds,
  provider_backoff_base_seconds,
  provider_backoff_max_seconds
) values
  ('priority', 1, 1, 250, 900, 300, 3600),
  ('daily', 2, 251, 1000, 86400, 900, 21600),
  ('weekly', 3, 1001, null, 604800, 1800, 43200)
on conflict (tier) do nothing;

alter table public.wheel_deep_scan_tiers enable row level security;
alter table public.wheel_deep_scan_tiers force row level security;

revoke all on public.wheel_deep_scan_tiers
  from public, anon, authenticated;
grant select, insert, update, delete on public.wheel_deep_scan_tiers
  to service_role;

create table if not exists public.wheel_deep_scan_work (
  symbol text not null
    references public.wheel_underlying_universe(symbol) on delete cascade,
  option_type text not null
    check (option_type in ('put', 'call')),
  coverage_tier text not null
    references public.wheel_deep_scan_tiers(tier),
  tier_priority smallint not null,
  tier_rank integer not null,
  product_priority integer not null default 0,
  candidate_yield numeric,
  dollar_volume numeric,
  daily_volume bigint,
  eligible boolean not null default true,
  next_due_at timestamptz not null default now(),
  lease_owner_id uuid,
  lease_token uuid,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  consecutive_failure_count integer not null default 0,
  last_outcome text
    check (
      last_outcome is null or
      last_outcome in ('complete', 'no_candidate', 'failed', 'provider_outage')
    ),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_scanned_at timestamptz,
  last_claim_latency_ms bigint,
  last_completion_latency_ms bigint,
  last_error text,
  last_batch_id uuid
    references public.wheel_market_batches(id) on delete set null,
  last_claim_token uuid,
  last_result jsonb,
  option_contract_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, option_type),
  constraint wheel_deep_scan_work_tier_priority_valid
    check (tier_priority between 1 and 100),
  constraint wheel_deep_scan_work_tier_rank_valid
    check (tier_rank >= 1),
  constraint wheel_deep_scan_work_attempts_valid
    check (attempt_count >= 0 and consecutive_failure_count >= 0),
  constraint wheel_deep_scan_work_contract_count_valid
    check (option_contract_count >= 0),
  constraint wheel_deep_scan_work_lease_shape_valid
    check (
      (
        lease_owner_id is null and
        lease_token is null and
        lease_acquired_at is null and
        lease_expires_at is null
      ) or
      (
        lease_owner_id is not null and
        lease_token is not null and
        lease_acquired_at is not null and
        lease_expires_at is not null and
        lease_expires_at > lease_acquired_at
      )
    )
);

alter table public.wheel_deep_scan_work enable row level security;
alter table public.wheel_deep_scan_work force row level security;

revoke all on public.wheel_deep_scan_work
  from public, anon, authenticated;
grant select, insert, update, delete on public.wheel_deep_scan_work
  to service_role;

create index if not exists wheel_deep_scan_work_due_idx
  on public.wheel_deep_scan_work (
    tier_priority,
    next_due_at,
    tier_rank,
    option_type,
    symbol
  )
  where eligible and lease_owner_id is null;

create index if not exists wheel_deep_scan_work_lease_expiry_idx
  on public.wheel_deep_scan_work (lease_expires_at)
  where lease_expires_at is not null;

create index if not exists wheel_deep_scan_work_tier_freshness_idx
  on public.wheel_deep_scan_work (
    coverage_tier,
    next_due_at,
    last_outcome
  )
  where eligible;

create index if not exists wheel_deep_scan_work_last_batch_idx
  on public.wheel_deep_scan_work (last_batch_id)
  where last_batch_id is not null;

create or replace function public.sync_wheel_deep_scan_work_queue(
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_active_symbols integer;
  v_inserted_units integer;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_updated_units integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('wheel_deep_scan_work_queue:sync', 0)
  );

  with inserted as (
    insert into public.wheel_deep_scan_work (
      symbol,
      option_type,
      coverage_tier,
      tier_priority,
      tier_rank,
      next_due_at,
      eligible,
      created_at,
      updated_at
    )
    select
      universe.symbol,
      option_types.option_type,
      'weekly',
      3,
      2147483647,
      v_now,
      true,
      v_now,
      v_now
    from public.wheel_underlying_universe as universe
    cross join (
      values ('put'::text), ('call'::text)
    ) as option_types(option_type)
    where universe.active
      and universe.optionable
    on conflict (symbol, option_type)
    do update set
      eligible = true,
      updated_at = excluded.updated_at
    returning 1
  )
  select count(*)::integer
  into v_inserted_units
  from inserted;

  update public.wheel_deep_scan_work as work
  set
    eligible = false,
    lease_owner_id = null,
    lease_token = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    updated_at = v_now
  where work.eligible
    and not exists (
      select 1
      from public.wheel_underlying_universe as universe
      where universe.symbol = work.symbol
        and universe.active
        and universe.optionable
    );

  with candidate_signal as (
    select
      candidates.symbol,
      candidates.option_type,
      max(
        coalesce(
          candidates.premium_yield,
          candidates.return_on_risk,
          0
        )
      ) as candidate_yield
    from public.wheel_deep_scan_candidates as candidates
    where candidates.as_of >= v_now - interval '30 days'
    group by candidates.symbol, candidates.option_type
  ),
  symbol_signal as (
    select
      universe.symbol,
      max(work.product_priority) as product_priority,
      max(snapshots.dollar_volume) as dollar_volume,
      max(snapshots.daily_volume) as daily_volume,
      max(signal.candidate_yield) as candidate_yield
    from public.wheel_underlying_universe as universe
    join public.wheel_deep_scan_work as work
      on work.symbol = universe.symbol
      and work.eligible
    left join public.wheel_underlying_snapshots as snapshots
      on snapshots.symbol = universe.symbol
    left join candidate_signal as signal
      on signal.symbol = universe.symbol
    where universe.active
      and universe.optionable
    group by universe.symbol
  ),
  ranked as (
    select
      signal.*,
      row_number() over (
        order by
          signal.product_priority desc,
          (signal.candidate_yield is not null) desc,
          signal.candidate_yield desc nulls last,
          signal.dollar_volume desc nulls last,
          signal.daily_volume desc nulls last,
          signal.symbol
      )::integer as tier_rank
    from symbol_signal as signal
  ),
  assigned as (
    select
      ranked.*,
      tiers.tier,
      tiers.priority,
      tiers.freshness_seconds
    from ranked
    join lateral (
      select configured.*
      from public.wheel_deep_scan_tiers as configured
      where configured.active
        and ranked.tier_rank >= configured.rank_start
        and (
          configured.rank_end is null or
          ranked.tier_rank <= configured.rank_end
        )
      order by configured.priority
      limit 1
    ) as tiers on true
  )
  update public.wheel_deep_scan_work as work
  set
    coverage_tier = assigned.tier,
    tier_priority = assigned.priority,
    tier_rank = assigned.tier_rank,
    candidate_yield = assigned.candidate_yield,
    dollar_volume = assigned.dollar_volume,
    daily_volume = assigned.daily_volume,
    next_due_at = case
      when assigned.priority < work.tier_priority then
        least(
          work.next_due_at,
          coalesce(work.last_scanned_at, v_now) +
            pg_catalog.make_interval(secs => assigned.freshness_seconds)
        )
      else work.next_due_at
    end,
    updated_at = v_now
  from assigned
  where work.symbol = assigned.symbol
    and work.eligible;

  get diagnostics v_updated_units = row_count;

  select count(*)::integer
  into v_active_symbols
  from public.wheel_underlying_universe
  where active and optionable;

  return pg_catalog.jsonb_build_object(
    'active_symbols', v_active_symbols,
    'eligible_units', v_updated_units,
    'upserted_units', v_inserted_units,
    'synced_at', v_now
  );
end;
$$;

create or replace function public.claim_wheel_deep_scan_work(
  p_owner_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_force boolean,
  p_now timestamptz
)
returns table (
  symbol text,
  option_type text,
  coverage_tier text,
  tier_priority smallint,
  tier_rank integer,
  next_due_at timestamptz,
  lease_owner_id uuid,
  lease_token uuid,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
begin
  if p_owner_id is null or
     p_limit < 1 or p_limit > 1000 or
     p_lease_seconds < 30 or p_lease_seconds > 7200 or
     p_force is null then
    raise exception 'Invalid wheel deep-scan claim request.';
  end if;

  update public.wheel_deep_scan_work as expired
  set
    lease_owner_id = null,
    lease_token = null,
    lease_acquired_at = null,
    lease_expires_at = null,
    updated_at = v_now
  where expired.lease_expires_at <= v_now;

  return query
  with selected as materialized (
    select work.symbol, work.option_type
    from public.wheel_deep_scan_work as work
    where work.eligible
      and work.lease_owner_id is null
      and (p_force or work.next_due_at <= v_now)
    order by
      work.tier_priority,
      work.next_due_at,
      work.tier_rank,
      work.option_type,
      work.symbol
    limit p_limit
    for update of work skip locked
  ),
  claimed as (
    update public.wheel_deep_scan_work as work
    set
      lease_owner_id = p_owner_id,
      lease_token = pg_catalog.gen_random_uuid(),
      lease_acquired_at = v_now,
      lease_expires_at =
        v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      attempt_count = work.attempt_count + 1,
      last_started_at = v_now,
      last_claim_latency_ms = greatest(
        0,
        floor(
          extract(epoch from (v_now - work.next_due_at)) * 1000
        )::bigint
      ),
      updated_at = v_now
    from selected
    where work.symbol = selected.symbol
      and work.option_type = selected.option_type
    returning work.*
  )
  select
    claimed.symbol,
    claimed.option_type,
    claimed.coverage_tier,
    claimed.tier_priority,
    claimed.tier_rank,
    claimed.next_due_at,
    claimed.lease_owner_id,
    claimed.lease_token,
    claimed.lease_acquired_at,
    claimed.lease_expires_at,
    claimed.attempt_count
  from claimed
  order by
    claimed.tier_priority,
    claimed.next_due_at,
    claimed.tier_rank,
    claimed.option_type,
    claimed.symbol;
end;
$$;

create or replace function public.peek_wheel_deep_scan_work(
  p_limit integer,
  p_force boolean,
  p_now timestamptz
)
returns table (
  symbol text,
  option_type text,
  coverage_tier text,
  tier_priority smallint,
  tier_rank integer,
  next_due_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
begin
  if p_limit < 1 or p_limit > 1000 or p_force is null then
    raise exception 'Invalid wheel deep-scan peek request.';
  end if;

  return query
  select
    work.symbol,
    work.option_type,
    work.coverage_tier,
    work.tier_priority,
    work.tier_rank,
    work.next_due_at
  from public.wheel_deep_scan_work as work
  where work.eligible
    and (
      work.lease_owner_id is null or
      work.lease_expires_at <= v_now
    )
    and (p_force or work.next_due_at <= v_now)
  order by
    work.tier_priority,
    work.next_due_at,
    work.tier_rank,
    work.option_type,
    work.symbol
  limit p_limit;
end;
$$;

create or replace function public.heartbeat_wheel_deep_scan_work(
  p_owner_id uuid,
  p_claims jsonb,
  p_lease_seconds integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim jsonb;
  v_count integer := 0;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_option_type text;
  v_symbol text;
  v_token uuid;
begin
  if p_owner_id is null or
     p_claims is null or
     pg_catalog.jsonb_typeof(p_claims) <> 'array' or
     pg_catalog.jsonb_array_length(p_claims) < 1 or
     pg_catalog.jsonb_array_length(p_claims) > 1000 or
     p_lease_seconds < 30 or p_lease_seconds > 7200 then
    raise exception 'Invalid wheel deep-scan heartbeat request.';
  end if;

  for v_claim in
    select value from pg_catalog.jsonb_array_elements(p_claims)
  loop
    v_symbol := v_claim ->> 'symbol';
    v_option_type := v_claim ->> 'option_type';
    v_token := (v_claim ->> 'lease_token')::uuid;

    update public.wheel_deep_scan_work as work
    set
      lease_expires_at =
        v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = v_now
    where work.symbol = v_symbol
      and work.option_type = v_option_type
      and work.lease_owner_id = p_owner_id
      and work.lease_token = v_token
      and work.lease_expires_at > v_now;

    if not found then
      raise exception 'Wheel deep-scan claim ownership is stale.';
    end if;

    v_count := v_count + 1;
  end loop;

  return pg_catalog.jsonb_build_object(
    'heartbeat_at', v_now,
    'renewed_count', v_count
  );
end;
$$;

create or replace function public.publish_wheel_deep_scan_compatibility(
  p_owner_id uuid,
  p_claims jsonb,
  p_candidates jsonb,
  p_coverage jsonb,
  p_lease_seconds integer,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim jsonb;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_option_type text;
  v_renewed integer := 0;
  v_symbol text;
  v_token uuid;
begin
  if p_owner_id is null or
     p_claims is null or
     pg_catalog.jsonb_typeof(p_claims) <> 'array' or
     pg_catalog.jsonb_array_length(p_claims) < 1 or
     pg_catalog.jsonb_array_length(p_claims) > 1000 or
     p_candidates is null or
     pg_catalog.jsonb_typeof(p_candidates) <> 'array' or
     pg_catalog.jsonb_array_length(p_candidates) > 10000 or
     p_coverage is null or
     pg_catalog.jsonb_typeof(p_coverage) <> 'array' or
     pg_catalog.jsonb_array_length(p_coverage) < 1 or
     pg_catalog.jsonb_array_length(p_coverage) > 10000 or
     p_lease_seconds < 30 or p_lease_seconds > 7200 then
    raise exception 'Invalid wheel deep-scan compatibility publication.';
  end if;

  if (
    select count(*) <> count(distinct (
      value ->> 'symbol',
      value ->> 'option_type'
    ))
    from pg_catalog.jsonb_array_elements(p_claims)
  ) then
    raise exception 'Wheel deep-scan compatibility claims contain duplicates.';
  end if;

  if (
    select count(*) <> count(distinct (
      value ->> 'persona',
      value ->> 'strategy',
      value ->> 'filter_key',
      value ->> 'symbol'
    ))
    from pg_catalog.jsonb_array_elements(p_candidates)
  ) or (
    select count(*) <> count(distinct (
      value ->> 'persona',
      value ->> 'strategy',
      value ->> 'filter_key',
      value ->> 'symbol'
    ))
    from pg_catalog.jsonb_array_elements(p_coverage)
  ) then
    raise exception 'Wheel deep-scan compatibility publication contains duplicates.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_coverage) as coverage(
      filter_key text,
      option_type text,
      persona text,
      strategy text,
      symbol text
    )
    where coverage.symbol is null
      or coverage.persona is null
      or coverage.strategy is null
      or coverage.filter_key is null
      or coverage.option_type not in ('put', 'call')
      or (
        coverage.option_type = 'put' and
        coverage.strategy not in ('short_put', 'put_credit_spread')
      )
      or (
        coverage.option_type = 'call' and
        coverage.strategy not in ('covered_call', 'call_credit_spread')
      )
      or not exists (
        select 1
        from pg_catalog.jsonb_to_recordset(p_claims) as claim(
          option_type text,
          symbol text
        )
        where claim.symbol = coverage.symbol
          and claim.option_type = coverage.option_type
      )
  ) then
    raise exception 'Wheel deep-scan coverage is outside the claimed work.';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_candidates) as candidate(
      filter_key text,
      option_type text,
      persona text,
      strategy text,
      symbol text
    )
    where candidate.symbol is null
      or candidate.persona is null
      or candidate.strategy is null
      or candidate.filter_key is null
      or candidate.option_type not in ('put', 'call')
      or (
        candidate.option_type = 'put' and
        candidate.strategy not in ('short_put', 'put_credit_spread')
      )
      or (
        candidate.option_type = 'call' and
        candidate.strategy not in ('covered_call', 'call_credit_spread')
      )
      or not exists (
        select 1
        from pg_catalog.jsonb_to_recordset(p_claims) as claim(
          option_type text,
          symbol text
        )
        where claim.symbol = candidate.symbol
          and claim.option_type = candidate.option_type
      )
      or not exists (
        select 1
        from pg_catalog.jsonb_to_recordset(p_coverage) as coverage(
          filter_key text,
          persona text,
          strategy text,
          symbol text
        )
        where coverage.symbol = candidate.symbol
          and coverage.persona = candidate.persona
          and coverage.strategy = candidate.strategy
          and coverage.filter_key = candidate.filter_key
      )
  ) then
    raise exception 'Wheel deep-scan candidate is outside the claimed coverage.';
  end if;

  for v_claim in
    select value
    from pg_catalog.jsonb_array_elements(p_claims)
    order by value ->> 'symbol', value ->> 'option_type'
  loop
    v_symbol := v_claim ->> 'symbol';
    v_option_type := v_claim ->> 'option_type';
    v_token := (v_claim ->> 'lease_token')::uuid;

    update public.wheel_deep_scan_work as work
    set
      lease_expires_at =
        v_now + pg_catalog.make_interval(secs => p_lease_seconds),
      updated_at = v_now
    where work.symbol = v_symbol
      and work.option_type = v_option_type
      and work.lease_owner_id = p_owner_id
      and work.lease_token = v_token
      and work.lease_expires_at > v_now;

    if not found then
      raise exception 'Wheel deep-scan compatibility ownership is stale.';
    end if;

    v_renewed := v_renewed + 1;
  end loop;

  delete from public.wheel_deep_scan_candidates as existing
  using pg_catalog.jsonb_to_recordset(p_coverage) as coverage(
    filter_key text,
    persona text,
    strategy text,
    symbol text
  )
  where existing.symbol = coverage.symbol
    and existing.persona = coverage.persona
    and existing.strategy = coverage.strategy
    and existing.filter_key = coverage.filter_key
    and not exists (
      select 1
      from pg_catalog.jsonb_to_recordset(p_candidates) as candidate(
        filter_key text,
        persona text,
        strategy text,
        symbol text
      )
      where candidate.symbol = coverage.symbol
        and candidate.persona = coverage.persona
        and candidate.strategy = coverage.strategy
        and candidate.filter_key = coverage.filter_key
    );

  insert into public.wheel_deep_scan_candidates (
    scan_run_id,
    persona,
    strategy,
    filter_key,
    symbol,
    company_name,
    exchange,
    score,
    option_type,
    expiration,
    dte,
    short_strike,
    long_strike,
    premium_received,
    premium_yield,
    annualized_yield,
    return_on_risk,
    annualized_return_on_risk,
    delta,
    implied_volatility,
    liquidity_quality,
    warning_count,
    underlying_price,
    underlying_as_of,
    trend,
    rsi14,
    ma20,
    ma50,
    ma200,
    warnings,
    errors,
    as_of,
    updated_at
  )
  select
    candidate.scan_run_id,
    candidate.persona,
    candidate.strategy,
    candidate.filter_key,
    candidate.symbol,
    candidate.company_name,
    candidate.exchange,
    candidate.score,
    candidate.option_type,
    candidate.expiration,
    candidate.dte,
    candidate.short_strike,
    candidate.long_strike,
    candidate.premium_received,
    candidate.premium_yield,
    candidate.annualized_yield,
    candidate.return_on_risk,
    candidate.annualized_return_on_risk,
    candidate.delta,
    candidate.implied_volatility,
    candidate.liquidity_quality,
    candidate.warning_count,
    candidate.underlying_price,
    candidate.underlying_as_of,
    candidate.trend,
    candidate.rsi14,
    candidate.ma20,
    candidate.ma50,
    candidate.ma200,
    coalesce(candidate.warnings, '[]'::jsonb),
    coalesce(candidate.errors, '[]'::jsonb),
    v_now,
    v_now
  from pg_catalog.jsonb_to_recordset(p_candidates) as candidate(
    scan_run_id uuid,
    persona text,
    strategy text,
    filter_key text,
    symbol text,
    company_name text,
    exchange text,
    score integer,
    option_type text,
    expiration date,
    dte integer,
    short_strike numeric,
    long_strike numeric,
    premium_received numeric,
    premium_yield numeric,
    annualized_yield numeric,
    return_on_risk numeric,
    annualized_return_on_risk numeric,
    delta numeric,
    implied_volatility numeric,
    liquidity_quality text,
    warning_count integer,
    underlying_price numeric,
    underlying_as_of timestamptz,
    trend text,
    rsi14 numeric,
    ma20 numeric,
    ma50 numeric,
    ma200 numeric,
    warnings jsonb,
    errors jsonb
  )
  on conflict (persona, strategy, filter_key, symbol)
  do update set
    scan_run_id = excluded.scan_run_id,
    company_name = excluded.company_name,
    exchange = excluded.exchange,
    score = excluded.score,
    option_type = excluded.option_type,
    expiration = excluded.expiration,
    dte = excluded.dte,
    short_strike = excluded.short_strike,
    long_strike = excluded.long_strike,
    premium_received = excluded.premium_received,
    premium_yield = excluded.premium_yield,
    annualized_yield = excluded.annualized_yield,
    return_on_risk = excluded.return_on_risk,
    annualized_return_on_risk = excluded.annualized_return_on_risk,
    delta = excluded.delta,
    implied_volatility = excluded.implied_volatility,
    liquidity_quality = excluded.liquidity_quality,
    warning_count = excluded.warning_count,
    underlying_price = excluded.underlying_price,
    underlying_as_of = excluded.underlying_as_of,
    trend = excluded.trend,
    rsi14 = excluded.rsi14,
    ma20 = excluded.ma20,
    ma50 = excluded.ma50,
    ma200 = excluded.ma200,
    warnings = excluded.warnings,
    errors = excluded.errors,
    as_of = excluded.as_of,
    updated_at = excluded.updated_at;

  insert into public.wheel_deep_scan_coverage (
    symbol,
    persona,
    strategy,
    filter_key,
    status,
    scan_run_id,
    last_scanned_at,
    option_contract_count,
    best_score,
    error,
    updated_at
  )
  select
    coverage.symbol,
    coverage.persona,
    coverage.strategy,
    coverage.filter_key,
    coverage.status,
    coverage.scan_run_id,
    v_now,
    coverage.option_contract_count,
    coverage.best_score,
    coverage.error,
    v_now
  from pg_catalog.jsonb_to_recordset(p_coverage) as coverage(
    symbol text,
    persona text,
    strategy text,
    filter_key text,
    status text,
    scan_run_id uuid,
    option_contract_count integer,
    best_score integer,
    error text
  )
  on conflict (symbol, persona, strategy, filter_key)
  do update set
    status = excluded.status,
    scan_run_id = excluded.scan_run_id,
    last_scanned_at = excluded.last_scanned_at,
    option_contract_count = excluded.option_contract_count,
    best_score = excluded.best_score,
    error = excluded.error,
    updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'candidate_count', pg_catalog.jsonb_array_length(p_candidates),
    'coverage_row_count', pg_catalog.jsonb_array_length(p_coverage),
    'published_at', v_now,
    'renewed_count', v_renewed
  );
end;
$$;

create or replace function public.complete_wheel_deep_scan_work_batch(
  p_batch_id uuid,
  p_owner_id uuid,
  p_results jsonb,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.wheel_market_batches%rowtype;
  v_contract_count integer;
  v_error text;
  v_failure_count integer;
  v_freshness_seconds integer;
  v_max_backoff integer;
  v_base_backoff integer;
  v_next_due_at timestamptz;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_option_type text;
  v_outcome text;
  v_processed integer := 0;
  v_replayed integer := 0;
  v_result jsonb;
  v_normalized_result jsonb;
  v_symbol text;
  v_token uuid;
  v_work public.wheel_deep_scan_work%rowtype;
begin
  if p_batch_id is null or
     p_owner_id is null or
     p_results is null or
     pg_catalog.jsonb_typeof(p_results) <> 'array' or
     pg_catalog.jsonb_array_length(p_results) < 1 or
     pg_catalog.jsonb_array_length(p_results) > 1000 then
    raise exception 'Invalid wheel deep-scan completion request.';
  end if;

  if (
    select count(*) <> count(distinct (
      value ->> 'symbol',
      value ->> 'option_type'
    ))
    from pg_catalog.jsonb_array_elements(p_results)
  ) then
    raise exception 'Wheel deep-scan completion contains duplicate work.';
  end if;

  select *
  into v_batch
  from public.wheel_market_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Wheel market coverage batch was not found.';
  end if;

  if v_batch.status = 'failed' then
    raise exception 'A failed wheel market coverage batch cannot complete.';
  end if;

  if v_batch.status not in ('facts_ready', 'complete') then
    raise exception 'Wheel market coverage batch facts are incomplete.';
  end if;

  for v_result in
    select value from pg_catalog.jsonb_array_elements(p_results)
  loop
    v_symbol := v_result ->> 'symbol';
    v_option_type := v_result ->> 'option_type';
    v_token := (v_result ->> 'lease_token')::uuid;
    v_outcome := v_result ->> 'outcome';
    v_contract_count := coalesce((v_result ->> 'option_contract_count')::integer, 0);
    v_error := nullif(v_result ->> 'error', '');
    v_normalized_result := pg_catalog.jsonb_build_object(
      'error', v_error,
      'lease_token', v_token,
      'option_contract_count', v_contract_count,
      'option_type', v_option_type,
      'outcome', v_outcome,
      'symbol', v_symbol
    );

    if v_symbol is null or
       v_option_type not in ('put', 'call') or
       v_token is null or
       v_outcome not in (
         'complete',
         'no_candidate',
         'failed',
         'provider_outage'
       ) or
       v_contract_count < 0 then
      raise exception 'Invalid wheel deep-scan completion result.';
    end if;

    select *
    into v_work
    from public.wheel_deep_scan_work as work
    where work.symbol = v_symbol
      and work.option_type = v_option_type
    for update;

    if not found then
      raise exception 'Wheel deep-scan work was not found.';
    end if;

    if v_work.lease_owner_id is null and
       v_work.last_batch_id = p_batch_id and
       v_work.last_claim_token = v_token then
      if v_work.last_result = v_normalized_result then
        v_replayed := v_replayed + 1;
        continue;
      end if;

      raise exception 'Wheel deep-scan completion replay payload differs.';
    end if;

    if v_work.lease_owner_id is distinct from p_owner_id or
       v_work.lease_token is distinct from v_token or
       v_work.lease_expires_at <= v_now then
      raise exception 'Wheel deep-scan completion ownership is stale.';
    end if;

    select
      tiers.freshness_seconds,
      tiers.provider_backoff_base_seconds,
      tiers.provider_backoff_max_seconds
    into
      v_freshness_seconds,
      v_base_backoff,
      v_max_backoff
    from public.wheel_deep_scan_tiers as tiers
    where tiers.tier = v_work.coverage_tier;

    if not found then
      raise exception 'Wheel deep-scan tier configuration is missing.';
    end if;

    v_failure_count := case
      when v_outcome in ('complete', 'no_candidate') then 0
      else v_work.consecutive_failure_count + 1
    end;

    v_next_due_at := case
      when v_outcome in ('complete', 'no_candidate') then
        v_now + pg_catalog.make_interval(secs => v_freshness_seconds)
      when v_outcome = 'provider_outage' then
        v_now + pg_catalog.make_interval(
          secs => least(
            v_max_backoff,
            (
              v_base_backoff *
              power(2, least(v_failure_count - 1, 10))
            )::integer
          )
        )
      else
        v_now + pg_catalog.make_interval(
          secs => least(
            3600,
            (300 * power(2, least(v_failure_count - 1, 10)))::integer
          )
        )
    end;

    update public.wheel_deep_scan_work as work
    set
      next_due_at = v_next_due_at,
      lease_owner_id = null,
      lease_token = null,
      lease_acquired_at = null,
      lease_expires_at = null,
      consecutive_failure_count = v_failure_count,
      last_outcome = v_outcome,
      last_completed_at = v_now,
      last_scanned_at = case
        when v_outcome in ('complete', 'no_candidate') then v_now
        else work.last_scanned_at
      end,
      last_completion_latency_ms = greatest(
        0,
        floor(
          extract(epoch from (v_now - work.last_started_at)) * 1000
        )::bigint
      ),
      last_error = left(v_error, 1000),
      last_batch_id = p_batch_id,
      last_claim_token = v_token,
      last_result = v_normalized_result,
      option_contract_count = v_contract_count,
      updated_at = v_now
    where work.symbol = v_symbol
      and work.option_type = v_option_type;

    v_processed := v_processed + 1;
  end loop;

  if v_batch.status <> 'complete' then
    update public.wheel_market_batches
    set
      status = 'complete',
      snapshot_count = 0,
      completed_at = v_now,
      updated_at = v_now,
      summary = summary || pg_catalog.jsonb_build_object(
        'coverage',
        pg_catalog.jsonb_build_object(
          'completed_at', v_now,
          'work_count', pg_catalog.jsonb_array_length(p_results)
        )
      )
    where id = p_batch_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'batch_id', p_batch_id,
    'completed_count', v_processed,
    'replayed_count', v_replayed,
    'status', 'complete'
  );
end;
$$;

create or replace function public.fail_wheel_deep_scan_work_batch(
  p_batch_id uuid,
  p_owner_id uuid,
  p_claims jsonb,
  p_error text,
  p_now timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim jsonb;
  v_failure_count integer;
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_option_type text;
  v_released integer := 0;
  v_stale integer := 0;
  v_symbol text;
  v_token uuid;
  v_work public.wheel_deep_scan_work%rowtype;
begin
  if p_batch_id is null or
     p_owner_id is null or
     p_claims is null or
     pg_catalog.jsonb_typeof(p_claims) <> 'array' or
     pg_catalog.jsonb_array_length(p_claims) < 1 or
     pg_catalog.jsonb_array_length(p_claims) > 1000 then
    raise exception 'Invalid wheel deep-scan failure request.';
  end if;

  for v_claim in
    select value from pg_catalog.jsonb_array_elements(p_claims)
  loop
    v_symbol := v_claim ->> 'symbol';
    v_option_type := v_claim ->> 'option_type';
    v_token := (v_claim ->> 'lease_token')::uuid;

    select *
    into v_work
    from public.wheel_deep_scan_work as work
    where work.symbol = v_symbol
      and work.option_type = v_option_type
    for update;

    if not found or
       v_work.lease_owner_id is distinct from p_owner_id or
       v_work.lease_token is distinct from v_token or
       v_work.lease_expires_at <= v_now then
      v_stale := v_stale + 1;
      continue;
    end if;

    v_failure_count := v_work.consecutive_failure_count + 1;

    update public.wheel_deep_scan_work as work
    set
      next_due_at =
        v_now + pg_catalog.make_interval(
          secs => least(
            3600,
            (300 * power(2, least(v_failure_count - 1, 10)))::integer
          )
        ),
      lease_owner_id = null,
      lease_token = null,
      lease_acquired_at = null,
      lease_expires_at = null,
      consecutive_failure_count = v_failure_count,
      last_outcome = 'failed',
      last_completed_at = v_now,
      last_completion_latency_ms = greatest(
        0,
        floor(
          extract(epoch from (v_now - work.last_started_at)) * 1000
        )::bigint
      ),
      last_error = left(p_error, 1000),
      last_batch_id = p_batch_id,
      last_claim_token = v_token,
      updated_at = v_now
    where work.symbol = v_symbol
      and work.option_type = v_option_type;

    v_released := v_released + 1;
  end loop;

  update public.wheel_market_batches
  set
    status = 'failed',
    error = left(p_error, 2000),
    completed_at = v_now,
    updated_at = v_now
  where id = p_batch_id
    and status <> 'complete';

  return pg_catalog.jsonb_build_object(
    'batch_id', p_batch_id,
    'failed_count', v_released,
    'stale_count', v_stale,
    'status', 'failed'
  );
end;
$$;

create or replace function public.get_wheel_deep_scan_work_metrics(
  p_now timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  with parameters as (
    select coalesce(p_now, clock_timestamp()) as measured_at
  ),
  classified as (
    select
      work.*,
      tiers.freshness_seconds,
      case
        when work.last_scanned_at is null then 'never_scanned'
        when work.last_outcome in ('failed', 'provider_outage') then 'failed'
        when work.next_due_at <= parameters.measured_at then 'overdue'
        else 'on_time'
      end as freshness_status
    from public.wheel_deep_scan_work as work
    join public.wheel_deep_scan_tiers as tiers
      on tiers.tier = work.coverage_tier
    cross join parameters
    where work.eligible
  ),
  tier_metrics as (
    select
      coverage_tier,
      min(tier_priority) as priority,
      min(freshness_seconds) as freshness_seconds,
      count(*) as total_count,
      count(*) filter (where freshness_status = 'on_time') as on_time_count,
      count(*) filter (where freshness_status = 'overdue') as overdue_count,
      count(*) filter (where freshness_status = 'failed') as failed_count,
      count(*) filter (
        where freshness_status = 'never_scanned'
      ) as never_scanned_count
    from classified
    group by coverage_tier
  )
  select pg_catalog.jsonb_build_object(
    'measured_at', parameters.measured_at,
    'total_count', (select count(*) from classified),
    'claimed_count', (
      select count(*) from classified where lease_owner_id is not null
    ),
    'backlog_count', (
      select count(*)
      from classified
      where next_due_at <= parameters.measured_at
        and (
          lease_owner_id is null or
          lease_expires_at <= parameters.measured_at
        )
    ),
    'oldest_due_age_seconds', coalesce((
      select greatest(
        0,
        floor(
          extract(
            epoch from (parameters.measured_at - min(next_due_at))
          )
        )::bigint
      )
      from classified
      where next_due_at <= parameters.measured_at
        and (
          lease_owner_id is null or
          lease_expires_at <= parameters.measured_at
        )
    ), 0),
    'average_claim_latency_ms', (
      select round(avg(last_claim_latency_ms))
      from classified
      where last_claim_latency_ms is not null
    ),
    'average_completion_latency_ms', (
      select round(avg(last_completion_latency_ms))
      from classified
      where last_completion_latency_ms is not null
    ),
    'freshness', pg_catalog.jsonb_build_object(
      'on_time', (
        select count(*) from classified where freshness_status = 'on_time'
      ),
      'overdue', (
        select count(*) from classified where freshness_status = 'overdue'
      ),
      'failed', (
        select count(*) from classified where freshness_status = 'failed'
      ),
      'never_scanned', (
        select count(*)
        from classified
        where freshness_status = 'never_scanned'
      )
    ),
    'tiers', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'tier', coverage_tier,
          'priority', priority,
          'freshness_seconds', freshness_seconds,
          'total_count', total_count,
          'on_time_count', on_time_count,
          'overdue_count', overdue_count,
          'failed_count', failed_count,
          'never_scanned_count', never_scanned_count,
          'compliance_ratio', case
            when total_count = 0 then 1
            else round(on_time_count::numeric / total_count, 6)
          end
        )
        order by priority
      )
      from tier_metrics
    ), '[]'::jsonb)
  )
  from parameters;
$$;

revoke all on function public.sync_wheel_deep_scan_work_queue(timestamptz)
  from public, anon, authenticated;
revoke all on function public.claim_wheel_deep_scan_work(
  uuid, integer, integer, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.peek_wheel_deep_scan_work(
  integer, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.heartbeat_wheel_deep_scan_work(
  uuid, jsonb, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.publish_wheel_deep_scan_compatibility(
  uuid, jsonb, jsonb, jsonb, integer, timestamptz
) from public, anon, authenticated;
revoke all on function public.complete_wheel_deep_scan_work_batch(
  uuid, uuid, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.fail_wheel_deep_scan_work_batch(
  uuid, uuid, jsonb, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.get_wheel_deep_scan_work_metrics(timestamptz)
  from public, anon, authenticated;

grant execute on function public.sync_wheel_deep_scan_work_queue(timestamptz)
  to service_role;
grant execute on function public.claim_wheel_deep_scan_work(
  uuid, integer, integer, boolean, timestamptz
) to service_role;
grant execute on function public.peek_wheel_deep_scan_work(
  integer, boolean, timestamptz
) to service_role;
grant execute on function public.heartbeat_wheel_deep_scan_work(
  uuid, jsonb, integer, timestamptz
) to service_role;
grant execute on function public.publish_wheel_deep_scan_compatibility(
  uuid, jsonb, jsonb, jsonb, integer, timestamptz
) to service_role;
grant execute on function public.complete_wheel_deep_scan_work_batch(
  uuid, uuid, jsonb, timestamptz
) to service_role;
grant execute on function public.fail_wheel_deep_scan_work_batch(
  uuid, uuid, jsonb, text, timestamptz
) to service_role;
grant execute on function public.get_wheel_deep_scan_work_metrics(timestamptz)
  to service_role;
