alter table public.wheel_screener_snapshots
  add column if not exists data_source_mode text not null default 'live';

alter table public.simulated_positions
  add column if not exists data_source_mode text not null default 'unknown',
  add column if not exists candidate_feed text,
  add column if not exists candidate_cache_status text,
  add column if not exists candidate_cache_source text,
  add column if not exists candidate_as_of timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'wheel_screener_snapshots_data_source_mode_valid'
      and conrelid = 'public.wheel_screener_snapshots'::regclass
  ) then
    alter table public.wheel_screener_snapshots
      add constraint wheel_screener_snapshots_data_source_mode_valid
      check (data_source_mode in ('demo', 'live'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_positions_data_source_mode_valid'
      and conrelid = 'public.simulated_positions'::regclass
  ) then
    alter table public.simulated_positions
      add constraint simulated_positions_data_source_mode_valid
      check (data_source_mode in ('unknown', 'demo', 'live'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_positions_candidate_feed_valid'
      and conrelid = 'public.simulated_positions'::regclass
  ) then
    alter table public.simulated_positions
      add constraint simulated_positions_candidate_feed_valid
      check (
        candidate_feed is null or
        candidate_feed in ('demo', 'indicative', 'opra')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_positions_candidate_cache_status_valid'
      and conrelid = 'public.simulated_positions'::regclass
  ) then
    alter table public.simulated_positions
      add constraint simulated_positions_candidate_cache_status_valid
      check (
        candidate_cache_status is null or
        candidate_cache_status in ('demo', 'fresh', 'stale')
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_positions_candidate_cache_source_valid'
      and conrelid = 'public.simulated_positions'::regclass
  ) then
    alter table public.simulated_positions
      add constraint simulated_positions_candidate_cache_source_valid
      check (
        candidate_cache_source is null or
        candidate_cache_source in (
          'demo',
          'live',
          'materialized',
          'memory_cache',
          'runtime_cache'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_positions_candidate_mode_feed_match'
      and conrelid = 'public.simulated_positions'::regclass
  ) then
    alter table public.simulated_positions
      add constraint simulated_positions_candidate_mode_feed_match
      check (
        data_source_mode = 'unknown' or
        (data_source_mode = 'demo' and candidate_feed = 'demo') or
        (data_source_mode = 'live' and candidate_feed in ('indicative', 'opra'))
      );
  end if;
end
$$;

drop index if exists public.wheel_screener_snapshots_lookup_idx;

create index wheel_screener_snapshots_lookup_idx
  on public.wheel_screener_snapshots (
    persona,
    strategy,
    filter_key,
    feed,
    data_source_mode,
    status,
    completed_at desc
  );

create or replace function public.open_simulated_position_atomic(p_input jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.paper_accounts%rowtype;
  v_position public.simulated_positions%rowtype;
  v_event public.simulated_position_events%rowtype;
  v_leg jsonb;
  v_leg_index integer;
  v_legs jsonb := '[]'::jsonb;
  v_contracts integer := (p_input->>'contracts')::integer;
  v_expiration_date date := nullif(p_input->>'expirationDate', '')::date;
  v_net_credit numeric;
  v_opened_at timestamptz := coalesce(
    ((nullif(p_input->>'openedAt', '')::date + time '12:00') at time zone 'UTC'),
    now()
  );
  v_provenance jsonb := coalesce(p_input->'dataProvenance', '{}'::jsonb);
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: Sign in to manage simulated positions.';
  end if;

  select coalesce(
    nullif(p_input->>'netCredit', '')::numeric,
    sum(
      case
        when leg.value->>'side' = 'short' then (leg.value->>'openPrice')::numeric
        else -((leg.value->>'openPrice')::numeric)
      end
    )
  )
  into v_net_credit
  from jsonb_array_elements(p_input->'legs') as leg(value);

  if v_net_credit is null or v_net_credit <= 0 then
    raise exception 'INVALID_NET_CREDIT: Position net credit must be greater than zero.';
  end if;

  insert into public.paper_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do update
    set user_id = excluded.user_id
  returning * into v_account;

  insert into public.simulated_positions (
    user_id,
    paper_account_id,
    source,
    status,
    strategy_type,
    symbol,
    opened_at,
    contracts_opened,
    contracts_remaining,
    net_credit,
    notes,
    underlying_price_at_open,
    expiration_date,
    data_source_mode,
    candidate_feed,
    candidate_cache_status,
    candidate_cache_source,
    candidate_as_of
  )
  values (
    v_user_id,
    v_account.id,
    'simulated',
    'open',
    p_input->>'strategyType',
    upper(p_input->>'symbol'),
    v_opened_at,
    v_contracts,
    v_contracts,
    v_net_credit,
    nullif(p_input->>'notes', ''),
    nullif(p_input->>'underlyingPriceAtOpen', '')::numeric,
    v_expiration_date,
    coalesce(nullif(v_provenance->>'sourceMode', ''), 'unknown'),
    nullif(v_provenance->>'feed', ''),
    nullif(v_provenance->>'cacheStatus', ''),
    nullif(v_provenance->>'cacheSource', ''),
    nullif(v_provenance->>'asOf', '')::timestamptz
  )
  returning * into v_position;

  for v_leg, v_leg_index in
    select value, ordinality - 1
    from jsonb_array_elements(p_input->'legs') with ordinality as legs(value, ordinality)
  loop
    insert into public.simulated_position_legs (
      position_id,
      leg_index,
      side,
      option_type,
      contract_symbol,
      strike,
      expiration_date,
      quantity,
      open_price,
      current_mark,
      bid_price,
      ask_price,
      mid_price,
      delta,
      gamma,
      theta,
      vega,
      rho,
      implied_volatility,
      open_interest,
      volume,
      quote_as_of,
      snapshot
    )
    values (
      v_position.id,
      coalesce(nullif(v_leg->>'legIndex', '')::integer, v_leg_index),
      v_leg->>'side',
      nullif(v_leg->>'optionType', ''),
      nullif(v_leg->>'contractSymbol', ''),
      nullif(v_leg->>'strike', '')::numeric,
      coalesce(nullif(v_leg->>'expirationDate', '')::date, v_expiration_date),
      coalesce(nullif(v_leg->>'quantity', '')::integer, v_contracts),
      (v_leg->>'openPrice')::numeric,
      nullif(v_leg->>'currentMark', '')::numeric,
      nullif(v_leg->>'bidPrice', '')::numeric,
      nullif(v_leg->>'askPrice', '')::numeric,
      nullif(v_leg->>'midPrice', '')::numeric,
      nullif(v_leg->>'delta', '')::numeric,
      nullif(v_leg->>'gamma', '')::numeric,
      nullif(v_leg->>'theta', '')::numeric,
      nullif(v_leg->>'vega', '')::numeric,
      nullif(v_leg->>'rho', '')::numeric,
      nullif(v_leg->>'impliedVolatility', '')::numeric,
      nullif(v_leg->>'openInterest', '')::bigint,
      nullif(v_leg->>'volume', '')::bigint,
      nullif(v_leg->>'quoteAsOf', '')::timestamptz,
      coalesce(v_leg->'snapshot', '{}'::jsonb)
    );
  end loop;

  select coalesce(jsonb_agg(to_jsonb(leg) order by leg.leg_index), '[]'::jsonb)
  into v_legs
  from public.simulated_position_legs leg
  where leg.position_id = v_position.id;

  insert into public.simulated_position_events (
    user_id,
    paper_account_id,
    position_id,
    event_type,
    quantity,
    price,
    cash_delta,
    realized_pnl_delta,
    margin_delta,
    metadata
  )
  values (
    v_user_id,
    v_account.id,
    v_position.id,
    'opened',
    v_contracts,
    v_net_credit,
    v_net_credit * v_contracts * 100,
    0,
    0,
    jsonb_build_object(
      'candidateSnapshot', coalesce(p_input->'candidateSnapshot', '{}'::jsonb),
      'dataProvenance', v_provenance,
      'multiplier', 100,
      'strategyType', p_input->>'strategyType'
    )
  )
  returning * into v_event;

  return jsonb_build_object(
    'paperAccount', to_jsonb(v_account),
    'position', to_jsonb(v_position),
    'legs', v_legs,
    'event', to_jsonb(v_event)
  );
end;
$$;
