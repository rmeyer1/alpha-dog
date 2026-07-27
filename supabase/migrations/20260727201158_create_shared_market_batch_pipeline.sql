create table if not exists public.wheel_market_batches (
  id uuid primary key default gen_random_uuid(),
  batch_key text not null unique,
  interval_started_at timestamptz not null,
  feed text not null,
  status text not null default 'running',
  asset_count integer not null default 0,
  ranked_count integer not null default 0,
  selected_count integer not null default 0,
  option_contract_count integer not null default 0,
  snapshot_count integer not null default 0,
  error_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz not null default now(),
  underlyings_completed_at timestamptz,
  facts_completed_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint wheel_market_batches_key_length_valid
    check (length(batch_key) between 1 and 200),
  constraint wheel_market_batches_feed_valid
    check (feed in ('opra', 'indicative')),
  constraint wheel_market_batches_status_valid
    check (status in ('running', 'facts_ready', 'scoring', 'complete', 'failed')),
  constraint wheel_market_batches_counts_valid
    check (
      asset_count >= 0 and
      ranked_count >= 0 and
      selected_count >= 0 and
      option_contract_count >= 0 and
      snapshot_count >= 0 and
      error_count >= 0
    ),
  constraint wheel_market_batches_summary_object_valid
    check (jsonb_typeof(summary) = 'object'),
  constraint wheel_market_batches_interval_feed_unique
    unique (interval_started_at, feed)
);

create index if not exists wheel_market_batches_status_interval_idx
  on public.wheel_market_batches (status, interval_started_at desc);

create table if not exists public.wheel_market_batch_underlyings (
  batch_id uuid not null
    references public.wheel_market_batches(id) on delete cascade,
  symbol text not null,
  company_name text not null,
  exchange text not null,
  universe_rank integer not null,
  selected_for_scoring boolean not null default false,
  stock_score numeric not null,
  price numeric not null,
  latest_trade_at timestamptz,
  daily_volume numeric,
  dollar_volume numeric,
  previous_close numeric,
  pct_change numeric,
  stock_snapshot jsonb not null default '{}'::jsonb,
  trend text not null default 'neutral',
  rsi14 numeric,
  ma20 numeric,
  ma50 numeric,
  ma200 numeric,
  technical_as_of timestamptz,
  earnings_context jsonb not null default '{}'::jsonb,
  earnings_as_of timestamptz,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (batch_id, symbol),
  constraint wheel_market_batch_underlyings_symbol_valid
    check (symbol ~ '^[A-Z0-9.-]{1,16}$'),
  constraint wheel_market_batch_underlyings_exchange_valid
    check (exchange in ('NYSE', 'NASDAQ')),
  constraint wheel_market_batch_underlyings_price_valid
    check (price > 0),
  constraint wheel_market_batch_underlyings_rank_valid
    check (universe_rank > 0),
  constraint wheel_market_batch_underlyings_trend_valid
    check (trend in ('bullish', 'neutral', 'bearish')),
  constraint wheel_market_batch_underlyings_snapshot_object_valid
    check (jsonb_typeof(stock_snapshot) = 'object'),
  constraint wheel_market_batch_underlyings_earnings_object_valid
    check (jsonb_typeof(earnings_context) = 'object')
);

create index if not exists wheel_market_batch_underlyings_rank_idx
  on public.wheel_market_batch_underlyings
    (batch_id, selected_for_scoring desc, universe_rank, symbol);

create table if not exists public.wheel_market_batch_option_contracts (
  batch_id uuid not null
    references public.wheel_market_batches(id) on delete cascade,
  contract_symbol text not null,
  underlying_symbol text not null,
  option_type text not null,
  strike numeric not null,
  expiration date not null,
  bid numeric not null,
  ask numeric not null,
  delta numeric,
  theta numeric,
  implied_volatility numeric,
  volume numeric,
  open_interest numeric,
  captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (batch_id, contract_symbol),
  constraint wheel_market_batch_option_contracts_underlying_fkey
    foreign key (batch_id, underlying_symbol)
    references public.wheel_market_batch_underlyings(batch_id, symbol)
    on delete cascade,
  constraint wheel_market_batch_option_contracts_symbol_valid
    check (underlying_symbol ~ '^[A-Z0-9.-]{1,16}$'),
  constraint wheel_market_batch_option_contracts_type_valid
    check (option_type in ('put', 'call')),
  constraint wheel_market_batch_option_contracts_quote_valid
    check (strike > 0 and bid >= 0 and ask >= bid)
);

create index if not exists wheel_market_batch_option_contracts_lookup_idx
  on public.wheel_market_batch_option_contracts
    (batch_id, underlying_symbol, option_type, expiration, strike);

create table if not exists public.wheel_market_batch_option_ingestions (
  batch_id uuid not null,
  symbol text not null,
  option_type text not null,
  status text not null,
  contract_count integer not null default 0,
  error text,
  duration_ms numeric not null default 0,
  completed_at timestamptz not null default now(),
  primary key (batch_id, symbol, option_type),
  constraint wheel_market_batch_option_ingestions_underlying_fkey
    foreign key (batch_id, symbol)
    references public.wheel_market_batch_underlyings(batch_id, symbol)
    on delete cascade,
  constraint wheel_market_batch_option_ingestions_type_valid
    check (option_type in ('put', 'call')),
  constraint wheel_market_batch_option_ingestions_status_valid
    check (status in ('complete', 'failed')),
  constraint wheel_market_batch_option_ingestions_values_valid
    check (contract_count >= 0 and duration_ms >= 0),
  constraint wheel_market_batch_option_ingestions_error_valid
    check (
      (status = 'complete' and error is null) or
      (status = 'failed' and error is not null)
    )
);

create index if not exists wheel_market_batch_option_ingestions_status_idx
  on public.wheel_market_batch_option_ingestions
    (batch_id, status, option_type);

create table if not exists public.wheel_market_batch_snapshots (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.wheel_market_batches(id) on delete cascade,
  persona text not null,
  strategy text not null,
  filter_key text not null,
  filters jsonb not null default '{}'::jsonb,
  feed text not null,
  result_limit integer not null,
  status text not null default 'building',
  screened_count integer not null default 0,
  skipped_count integer not null default 0,
  candidate_count integer not null default 0,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  as_of timestamptz not null,
  next_suggested_refresh_at timestamptz,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint wheel_market_batch_snapshots_identity_unique
    unique (batch_id, persona, strategy, filter_key, feed),
  constraint wheel_market_batch_snapshots_id_batch_unique
    unique (id, batch_id),
  constraint wheel_market_batch_snapshots_persona_valid
    check (
      persona in (
        'conservative_wheel',
        'balanced_wheel',
        'aggressive_yield',
        'weekly_theta',
        'high_iv_hunter'
      )
    ),
  constraint wheel_market_batch_snapshots_strategy_valid
    check (
      strategy in (
        'short_put',
        'covered_call',
        'put_credit_spread',
        'call_credit_spread'
      )
    ),
  constraint wheel_market_batch_snapshots_filter_key_length_valid
    check (length(filter_key) between 1 and 1000),
  constraint wheel_market_batch_snapshots_filters_object_valid
    check (jsonb_typeof(filters) = 'object'),
  constraint wheel_market_batch_snapshots_feed_valid
    check (feed in ('opra', 'indicative')),
  constraint wheel_market_batch_snapshots_limit_valid
    check (result_limit between 1 and 500),
  constraint wheel_market_batch_snapshots_status_valid
    check (status in ('building', 'complete', 'failed')),
  constraint wheel_market_batch_snapshots_counts_valid
    check (
      screened_count >= 0 and
      skipped_count >= 0 and
      candidate_count >= 0
    ),
  constraint wheel_market_batch_snapshots_warnings_array_valid
    check (jsonb_typeof(warnings) = 'array'),
  constraint wheel_market_batch_snapshots_errors_array_valid
    check (jsonb_typeof(errors) = 'array')
);

create index if not exists wheel_market_batch_snapshots_batch_status_idx
  on public.wheel_market_batch_snapshots (batch_id, status);

create index if not exists wheel_market_batch_snapshots_context_idx
  on public.wheel_market_batch_snapshots
    (persona, strategy, filter_key, feed, status, completed_at desc);

create table if not exists public.wheel_market_batch_candidates (
  snapshot_id uuid not null
    references public.wheel_market_batch_snapshots(id) on delete cascade,
  rank integer not null,
  symbol text not null,
  company_name text not null,
  exchange text not null,
  score integer not null,
  strategy text not null,
  option_type text not null,
  expiration date not null,
  dte integer not null,
  short_strike numeric not null,
  long_strike numeric,
  premium_received numeric,
  premium_yield numeric,
  annualized_yield numeric,
  return_on_risk numeric,
  annualized_return_on_risk numeric,
  delta numeric,
  implied_volatility numeric,
  liquidity_quality text not null,
  warning_count integer not null default 0,
  underlying_price numeric not null,
  underlying_as_of timestamptz,
  trend text not null,
  rsi14 numeric,
  ma20 numeric,
  ma50 numeric,
  ma200 numeric,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  as_of timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, symbol, strategy),
  constraint wheel_market_batch_candidates_rank_valid
    check (rank > 0),
  constraint wheel_market_batch_candidates_symbol_valid
    check (symbol ~ '^[A-Z0-9.-]{1,16}$'),
  constraint wheel_market_batch_candidates_exchange_valid
    check (exchange in ('NYSE', 'NASDAQ')),
  constraint wheel_market_batch_candidates_score_valid
    check (score between 0 and 100),
  constraint wheel_market_batch_candidates_strategy_valid
    check (
      strategy in (
        'short_put',
        'covered_call',
        'put_credit_spread',
        'call_credit_spread'
      )
    ),
  constraint wheel_market_batch_candidates_option_type_valid
    check (option_type in ('put', 'call')),
  constraint wheel_market_batch_candidates_dte_valid
    check (dte >= 0),
  constraint wheel_market_batch_candidates_strikes_valid
    check (
      short_strike > 0 and
      (long_strike is null or long_strike > 0)
    ),
  constraint wheel_market_batch_candidates_warning_count_valid
    check (warning_count >= 0),
  constraint wheel_market_batch_candidates_liquidity_quality_valid
    check (
      liquidity_quality in (
        'excellent',
        'good',
        'acceptable',
        'weak',
        'poor',
        'unknown'
      )
    ),
  constraint wheel_market_batch_candidates_underlying_price_valid
    check (underlying_price > 0),
  constraint wheel_market_batch_candidates_trend_valid
    check (trend in ('bullish', 'neutral', 'bearish')),
  constraint wheel_market_batch_candidates_warnings_array_valid
    check (jsonb_typeof(warnings) = 'array'),
  constraint wheel_market_batch_candidates_errors_array_valid
    check (jsonb_typeof(errors) = 'array')
);

create index if not exists wheel_market_batch_candidates_snapshot_rank_idx
  on public.wheel_market_batch_candidates (snapshot_id, rank, symbol);

create table if not exists public.wheel_market_batch_current_snapshots (
  persona text not null,
  strategy text not null,
  filter_key text not null,
  feed text not null,
  batch_id uuid not null
    references public.wheel_market_batches(id) on delete restrict,
  snapshot_id uuid not null,
  published_at timestamptz not null default now(),
  primary key (persona, strategy, filter_key, feed),
  constraint wheel_market_batch_current_snapshots_snapshot_fkey
    foreign key (snapshot_id, batch_id)
    references public.wheel_market_batch_snapshots(id, batch_id)
    on delete restrict
);

create index if not exists wheel_market_batch_current_snapshots_batch_idx
  on public.wheel_market_batch_current_snapshots (batch_id);

create index if not exists wheel_market_batch_current_snapshots_snapshot_idx
  on public.wheel_market_batch_current_snapshots (snapshot_id);

create table if not exists public.wheel_market_batch_metrics (
  batch_id uuid not null
    references public.wheel_market_batches(id) on delete cascade,
  phase text not null,
  operation text not null,
  provider_requests integer not null default 0,
  database_rows_written integer not null default 0,
  duration_ms numeric not null default 0,
  recorded_at timestamptz not null default now(),
  primary key (batch_id, phase, operation),
  constraint wheel_market_batch_metrics_phase_valid
    check (phase in ('ingestion', 'scoring', 'publication')),
  constraint wheel_market_batch_metrics_operation_valid
    check (
      operation in (
        'asset_universe',
        'stock_snapshots',
        'technical_bars',
        'earnings',
        'option_put',
        'option_call',
        'candidate_scoring',
        'snapshot_publication'
      )
    ),
  constraint wheel_market_batch_metrics_values_valid
    check (
      provider_requests >= 0 and
      database_rows_written >= 0 and
      duration_ms >= 0
    )
);

alter table public.wheel_market_batches enable row level security;
alter table public.wheel_market_batches force row level security;
alter table public.wheel_market_batch_underlyings enable row level security;
alter table public.wheel_market_batch_underlyings force row level security;
alter table public.wheel_market_batch_option_contracts enable row level security;
alter table public.wheel_market_batch_option_contracts force row level security;
alter table public.wheel_market_batch_option_ingestions enable row level security;
alter table public.wheel_market_batch_option_ingestions force row level security;
alter table public.wheel_market_batch_snapshots enable row level security;
alter table public.wheel_market_batch_snapshots force row level security;
alter table public.wheel_market_batch_candidates enable row level security;
alter table public.wheel_market_batch_candidates force row level security;
alter table public.wheel_market_batch_current_snapshots enable row level security;
alter table public.wheel_market_batch_current_snapshots force row level security;
alter table public.wheel_market_batch_metrics enable row level security;
alter table public.wheel_market_batch_metrics force row level security;

revoke all on table public.wheel_market_batches
  from public, anon, authenticated;
revoke all on table public.wheel_market_batch_underlyings
  from public, anon, authenticated;
revoke all on table public.wheel_market_batch_option_contracts
  from public, anon, authenticated;
revoke all on table public.wheel_market_batch_option_ingestions
  from public, anon, authenticated;
revoke all on table public.wheel_market_batch_snapshots
  from public, anon, authenticated;
revoke all on table public.wheel_market_batch_candidates
  from public, anon, authenticated;
revoke all on table public.wheel_market_batch_current_snapshots
  from public, anon, authenticated;
revoke all on table public.wheel_market_batch_metrics
  from public, anon, authenticated;

grant select, insert, update, delete on table public.wheel_market_batches
  to service_role;
grant select, insert, update, delete
  on table public.wheel_market_batch_underlyings to service_role;
grant select, insert, update, delete
  on table public.wheel_market_batch_option_contracts to service_role;
grant select, insert, update, delete
  on table public.wheel_market_batch_option_ingestions to service_role;
grant select, insert, update, delete
  on table public.wheel_market_batch_snapshots to service_role;
grant select, insert, update, delete
  on table public.wheel_market_batch_candidates to service_role;
grant select, insert, update, delete
  on table public.wheel_market_batch_current_snapshots to service_role;
grant select, insert, update, delete
  on table public.wheel_market_batch_metrics to service_role;

create or replace function public.create_wheel_market_batch(
  p_batch_key text,
  p_interval_started_at timestamptz,
  p_feed text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.wheel_market_batches%rowtype;
begin
  if p_batch_key is null or
     length(p_batch_key) < 1 or
     length(p_batch_key) > 200 or
     p_interval_started_at is null or
     p_feed not in ('opra', 'indicative') then
    raise exception 'Invalid wheel market batch identity.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'wheel_market_batch:' ||
      p_interval_started_at::text ||
      ':' ||
      p_feed,
      0
    )
  );

  select *
  into v_batch
  from public.wheel_market_batches
  where interval_started_at = p_interval_started_at
    and feed = p_feed;

  if found then
    return pg_catalog.jsonb_build_object(
      'batch_id', v_batch.id,
      'batch_key', v_batch.batch_key,
      'created', false,
      'status', v_batch.status
    );
  end if;

  insert into public.wheel_market_batches (
    batch_key,
    interval_started_at,
    feed
  ) values (
    p_batch_key,
    p_interval_started_at,
    p_feed
  )
  returning * into v_batch;

  return pg_catalog.jsonb_build_object(
    'batch_id', v_batch.id,
    'batch_key', v_batch.batch_key,
    'created', true,
    'status', v_batch.status
  );
end;
$$;

create or replace function public.complete_wheel_market_batch_facts(
  p_batch_id uuid,
  p_asset_count integer,
  p_ranked_count integer,
  p_selected_count integer,
  p_option_contract_count integer,
  p_error_count integer,
  p_summary jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.wheel_market_batches%rowtype;
begin
  if p_batch_id is null or
     p_asset_count < 0 or
     p_ranked_count < 0 or
     p_selected_count < 0 or
     p_option_contract_count < 0 or
     p_error_count < 0 or
     p_summary is null or
     pg_catalog.jsonb_typeof(p_summary) <> 'object' then
    raise exception 'Invalid wheel market batch fact summary.';
  end if;

  select *
  into v_batch
  from public.wheel_market_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Wheel market batch was not found.';
  end if;

  if v_batch.status = 'failed' then
    raise exception 'A failed wheel market batch cannot accept facts.';
  end if;

  if v_batch.status in ('facts_ready', 'scoring', 'complete') then
    return pg_catalog.jsonb_build_object(
      'batch_id', v_batch.id,
      'status', v_batch.status
    );
  end if;

  update public.wheel_market_batches
  set
    status = 'facts_ready',
    asset_count = p_asset_count,
    ranked_count = p_ranked_count,
    selected_count = p_selected_count,
    option_contract_count = p_option_contract_count,
    error_count = p_error_count,
    summary = summary || p_summary,
    facts_completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_batch_id
  returning * into v_batch;

  return pg_catalog.jsonb_build_object(
    'batch_id', v_batch.id,
    'status', v_batch.status
  );
end;
$$;

create or replace function public.checkpoint_wheel_market_batch_underlyings(
  p_batch_id uuid,
  p_asset_count integer,
  p_ranked_count integer,
  p_selected_count integer,
  p_summary jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.wheel_market_batches%rowtype;
begin
  if p_batch_id is null or
     p_asset_count < 0 or
     p_ranked_count < 0 or
     p_selected_count < 0 or
     p_summary is null or
     pg_catalog.jsonb_typeof(p_summary) <> 'object' then
    raise exception 'Invalid wheel market batch underlying checkpoint.';
  end if;

  select *
  into v_batch
  from public.wheel_market_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Wheel market batch was not found.';
  end if;

  if v_batch.status = 'failed' then
    raise exception 'A failed wheel market batch cannot accept underlyings.';
  end if;

  if v_batch.underlyings_completed_at is not null then
    return pg_catalog.jsonb_build_object(
      'asset_count', v_batch.asset_count,
      'batch_id', v_batch.id,
      'ranked_count', v_batch.ranked_count,
      'selected_count', v_batch.selected_count
    );
  end if;

  update public.wheel_market_batches
  set
    asset_count = p_asset_count,
    ranked_count = p_ranked_count,
    selected_count = p_selected_count,
    summary = pg_catalog.jsonb_set(
      summary,
      '{underlyings}',
      p_summary,
      true
    ),
    underlyings_completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_batch_id
  returning * into v_batch;

  return pg_catalog.jsonb_build_object(
    'asset_count', v_batch.asset_count,
    'batch_id', v_batch.id,
    'ranked_count', v_batch.ranked_count,
    'selected_count', v_batch.selected_count
  );
end;
$$;

create or replace function public.create_wheel_market_batch_snapshot(
  p_batch_id uuid,
  p_persona text,
  p_strategy text,
  p_filter_key text,
  p_filters jsonb,
  p_feed text,
  p_result_limit integer,
  p_as_of timestamptz,
  p_next_suggested_refresh_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_status text;
  v_snapshot public.wheel_market_batch_snapshots%rowtype;
begin
  if p_batch_id is null or
     p_persona not in (
       'conservative_wheel',
       'balanced_wheel',
       'aggressive_yield',
       'weekly_theta',
       'high_iv_hunter'
     ) or
     p_strategy not in (
       'short_put',
       'covered_call',
       'put_credit_spread',
       'call_credit_spread'
     ) or
     p_filter_key is null or
     length(p_filter_key) < 1 or
     length(p_filter_key) > 1000 or
     p_filters is null or
     pg_catalog.jsonb_typeof(p_filters) <> 'object' or
     p_feed not in ('opra', 'indicative') or
     p_result_limit < 1 or
     p_result_limit > 500 or
     p_as_of is null then
    raise exception 'Invalid wheel market batch snapshot identity.';
  end if;

  select status
  into v_batch_status
  from public.wheel_market_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Wheel market batch was not found.';
  end if;

  if v_batch_status not in ('facts_ready', 'scoring', 'complete') then
    raise exception 'Wheel market batch facts are not ready for scoring.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'wheel_market_batch_snapshot:' ||
      p_batch_id::text ||
      ':' ||
      p_persona ||
      ':' ||
      p_strategy ||
      ':' ||
      p_filter_key ||
      ':' ||
      p_feed,
      0
    )
  );

  insert into public.wheel_market_batch_snapshots (
    batch_id,
    persona,
    strategy,
    filter_key,
    filters,
    feed,
    result_limit,
    as_of,
    next_suggested_refresh_at
  ) values (
    p_batch_id,
    p_persona,
    p_strategy,
    p_filter_key,
    p_filters,
    p_feed,
    p_result_limit,
    p_as_of,
    p_next_suggested_refresh_at
  )
  on conflict (batch_id, persona, strategy, filter_key, feed)
    do nothing
  returning * into v_snapshot;

  if not found then
    select *
    into v_snapshot
    from public.wheel_market_batch_snapshots
    where batch_id = p_batch_id
      and persona = p_persona
      and strategy = p_strategy
      and filter_key = p_filter_key
      and feed = p_feed;
  end if;

  update public.wheel_market_batches
  set status = case
      when status = 'facts_ready' then 'scoring'
      else status
    end,
    updated_at = clock_timestamp()
  where id = p_batch_id;

  return pg_catalog.jsonb_build_object(
    'snapshot_id', v_snapshot.id,
    'status', v_snapshot.status
  );
end;
$$;

create or replace function public.publish_wheel_market_batch_snapshot(
  p_snapshot_id uuid,
  p_screened_count integer,
  p_skipped_count integer,
  p_candidate_count integer,
  p_warnings jsonb,
  p_errors jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch_interval timestamptz;
  v_batch_status text;
  v_current_interval timestamptz;
  v_snapshot public.wheel_market_batch_snapshots%rowtype;
begin
  if p_snapshot_id is null or
     p_screened_count < 0 or
     p_skipped_count < 0 or
     p_candidate_count < 0 or
     p_warnings is null or
     pg_catalog.jsonb_typeof(p_warnings) <> 'array' or
     p_errors is null or
     pg_catalog.jsonb_typeof(p_errors) <> 'array' then
    raise exception 'Invalid wheel market batch publication summary.';
  end if;

  select *
  into v_snapshot
  from public.wheel_market_batch_snapshots
  where id = p_snapshot_id
  for update;

  if not found then
    raise exception 'Wheel market batch snapshot was not found.';
  end if;

  if v_snapshot.status = 'failed' then
    raise exception 'A failed wheel market batch snapshot cannot be published.';
  end if;

  if v_snapshot.status = 'complete' then
    return pg_catalog.jsonb_build_object(
      'batch_id', v_snapshot.batch_id,
      'published', false,
      'snapshot_id', v_snapshot.id,
      'status', v_snapshot.status
    );
  end if;

  select status, interval_started_at
  into v_batch_status, v_batch_interval
  from public.wheel_market_batches
  where id = v_snapshot.batch_id
  for update;

  if v_batch_status not in ('facts_ready', 'scoring', 'complete') then
    raise exception 'Wheel market batch is not publishable.';
  end if;

  if (
    select count(*)::integer
    from public.wheel_market_batch_candidates
    where snapshot_id = p_snapshot_id
  ) <> p_candidate_count then
    raise exception 'Wheel market batch candidate count does not match.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'wheel_market_batch_pointer:' ||
      v_snapshot.persona ||
      ':' ||
      v_snapshot.strategy ||
      ':' ||
      v_snapshot.filter_key ||
      ':' ||
      v_snapshot.feed,
      0
    )
  );

  update public.wheel_market_batch_snapshots
  set
    status = 'complete',
    screened_count = p_screened_count,
    skipped_count = p_skipped_count,
    candidate_count = p_candidate_count,
    warnings = p_warnings,
    errors = p_errors,
    completed_at = clock_timestamp()
  where id = p_snapshot_id
  returning * into v_snapshot;

  select batches.interval_started_at
  into v_current_interval
  from public.wheel_market_batch_current_snapshots as current_snapshots
  join public.wheel_market_batches as batches
    on batches.id = current_snapshots.batch_id
  where current_snapshots.persona = v_snapshot.persona
    and current_snapshots.strategy = v_snapshot.strategy
    and current_snapshots.filter_key = v_snapshot.filter_key
    and current_snapshots.feed = v_snapshot.feed
  for update of current_snapshots;

  if found and v_current_interval > v_batch_interval then
    return pg_catalog.jsonb_build_object(
      'batch_id', v_snapshot.batch_id,
      'published', false,
      'snapshot_id', v_snapshot.id,
      'status', v_snapshot.status
    );
  end if;

  insert into public.wheel_market_batch_current_snapshots (
    persona,
    strategy,
    filter_key,
    feed,
    batch_id,
    snapshot_id,
    published_at
  ) values (
    v_snapshot.persona,
    v_snapshot.strategy,
    v_snapshot.filter_key,
    v_snapshot.feed,
    v_snapshot.batch_id,
    v_snapshot.id,
    clock_timestamp()
  )
  on conflict (persona, strategy, filter_key, feed)
  do update set
    batch_id = excluded.batch_id,
    snapshot_id = excluded.snapshot_id,
    published_at = excluded.published_at;

  return pg_catalog.jsonb_build_object(
    'batch_id', v_snapshot.batch_id,
    'published', true,
    'snapshot_id', v_snapshot.id,
    'status', v_snapshot.status
  );
end;
$$;

create or replace function public.complete_wheel_market_batch(
  p_batch_id uuid,
  p_expected_snapshot_count integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.wheel_market_batches%rowtype;
  v_complete_count integer;
begin
  if p_batch_id is null or
     p_expected_snapshot_count < 1 or
     p_expected_snapshot_count > 100 then
    raise exception 'Invalid wheel market batch completion request.';
  end if;

  select *
  into v_batch
  from public.wheel_market_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Wheel market batch was not found.';
  end if;

  if v_batch.status = 'failed' then
    raise exception 'A failed wheel market batch cannot be completed.';
  end if;

  if v_batch.status = 'complete' then
    return pg_catalog.jsonb_build_object(
      'batch_id', v_batch.id,
      'snapshot_count', v_batch.snapshot_count,
      'status', v_batch.status
    );
  end if;

  select count(*)::integer
  into v_complete_count
  from public.wheel_market_batch_snapshots
  where batch_id = p_batch_id
    and status = 'complete';

  if v_complete_count <> p_expected_snapshot_count or exists (
    select 1
    from public.wheel_market_batch_snapshots
    where batch_id = p_batch_id
      and status <> 'complete'
  ) then
    raise exception 'Wheel market batch snapshots are incomplete.';
  end if;

  update public.wheel_market_batches
  set
    status = 'complete',
    snapshot_count = v_complete_count,
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_batch_id
  returning * into v_batch;

  return pg_catalog.jsonb_build_object(
    'batch_id', v_batch.id,
    'snapshot_count', v_batch.snapshot_count,
    'status', v_batch.status
  );
end;
$$;

create or replace function public.fail_wheel_market_batch(
  p_batch_id uuid,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_batch_id is null or
     p_error is null or
     length(p_error) < 1 or
     length(p_error) > 1000 then
    raise exception 'Invalid wheel market batch failure.';
  end if;

  update public.wheel_market_batches
  set
    status = 'failed',
    error = p_error,
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
  where id = p_batch_id
    and status <> 'complete';

  return found;
end;
$$;

create or replace function public.prune_wheel_market_batch_history(
  p_completed_before timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted_count integer;
begin
  if p_completed_before is null or
     p_completed_before > clock_timestamp() then
    raise exception 'Invalid wheel market batch retention boundary.';
  end if;

  with deleted as (
    delete from public.wheel_market_batches as batches
    where batches.status in ('complete', 'failed')
      and batches.completed_at < p_completed_before
      and not exists (
        select 1
        from public.wheel_market_batch_current_snapshots as current_snapshots
        where current_snapshots.batch_id = batches.id
      )
    returning 1
  )
  select count(*)::integer
  into v_deleted_count
  from deleted;

  return v_deleted_count;
end;
$$;

revoke all on function public.create_wheel_market_batch(
  text, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.complete_wheel_market_batch_facts(
  uuid, integer, integer, integer, integer, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.checkpoint_wheel_market_batch_underlyings(
  uuid, integer, integer, integer, jsonb
) from public, anon, authenticated;
revoke all on function public.create_wheel_market_batch_snapshot(
  uuid, text, text, text, jsonb, text, integer, timestamptz, timestamptz
) from public, anon, authenticated;
revoke all on function public.publish_wheel_market_batch_snapshot(
  uuid, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
revoke all on function public.complete_wheel_market_batch(
  uuid, integer
) from public, anon, authenticated;
revoke all on function public.fail_wheel_market_batch(
  uuid, text
) from public, anon, authenticated;
revoke all on function public.prune_wheel_market_batch_history(
  timestamptz
) from public, anon, authenticated;

grant execute on function public.create_wheel_market_batch(
  text, timestamptz, text
) to service_role;
grant execute on function public.complete_wheel_market_batch_facts(
  uuid, integer, integer, integer, integer, integer, jsonb
) to service_role;
grant execute on function public.checkpoint_wheel_market_batch_underlyings(
  uuid, integer, integer, integer, jsonb
) to service_role;
grant execute on function public.create_wheel_market_batch_snapshot(
  uuid, text, text, text, jsonb, text, integer, timestamptz, timestamptz
) to service_role;
grant execute on function public.publish_wheel_market_batch_snapshot(
  uuid, integer, integer, integer, jsonb, jsonb
) to service_role;
grant execute on function public.complete_wheel_market_batch(
  uuid, integer
) to service_role;
grant execute on function public.fail_wheel_market_batch(
  uuid, text
) to service_role;
grant execute on function public.prune_wheel_market_batch_history(
  timestamptz
) to service_role;
