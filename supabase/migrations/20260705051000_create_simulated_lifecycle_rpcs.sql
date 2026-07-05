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
    expiration_date
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
    v_expiration_date
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

create or replace function public.close_simulated_position_atomic(
  p_position_id uuid,
  p_close_price numeric,
  p_contracts_to_close integer,
  p_closed_at timestamptz default now(),
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_position public.simulated_positions%rowtype;
  v_updated_position public.simulated_positions%rowtype;
  v_event public.simulated_position_events%rowtype;
  v_contracts_remaining integer;
  v_status text;
  v_closed_at_for_position timestamptz;
  v_realized_pnl numeric;
  v_cash_delta numeric;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: Sign in to manage simulated positions.';
  end if;

  select *
  into v_position
  from public.simulated_positions
  where id = p_position_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'SIMULATED_POSITION_NOT_FOUND: Simulated position was not found.';
  end if;

  if v_position.contracts_remaining <= 0 or v_position.status = 'closed' then
    raise exception 'SIMULATED_POSITION_ALREADY_CLOSED: Simulated position is already closed.';
  end if;

  if p_contracts_to_close > v_position.contracts_remaining then
    raise exception 'SIMULATED_CLOSE_QUANTITY_EXCEEDS_REMAINING: Contracts to close cannot exceed contracts remaining.';
  end if;

  v_contracts_remaining := v_position.contracts_remaining - p_contracts_to_close;
  v_status := case when v_contracts_remaining = 0 then 'closed' else 'partially_closed' end;
  v_closed_at_for_position := case when v_contracts_remaining = 0 then p_closed_at else null end;
  v_realized_pnl := ((v_position.net_credit - p_close_price) * p_contracts_to_close * 100);
  v_cash_delta := -(p_close_price * p_contracts_to_close * 100);

  update public.simulated_positions
  set closed_at = v_closed_at_for_position,
      contracts_remaining = v_contracts_remaining,
      status = v_status
  where id = v_position.id
    and user_id = v_user_id
  returning * into v_updated_position;

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
    v_position.paper_account_id,
    v_position.id,
    case when v_contracts_remaining = 0 then 'full_close' else 'partial_close' end,
    p_contracts_to_close,
    p_close_price,
    v_cash_delta,
    v_realized_pnl,
    0,
    jsonb_build_object(
      'closedAt', p_closed_at,
      'multiplier', 100,
      'notes', p_notes,
      'previousContractsRemaining', v_position.contracts_remaining
    )
  )
  returning * into v_event;

  return jsonb_build_object(
    'position', to_jsonb(v_updated_position),
    'event', to_jsonb(v_event)
  );
end;
$$;

create or replace function public.expire_simulated_position_atomic(
  p_position_id uuid,
  p_underlying_price_at_expiration numeric,
  p_expired_at timestamptz default now(),
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_position public.simulated_positions%rowtype;
  v_updated_position public.simulated_positions%rowtype;
  v_event public.simulated_position_events%rowtype;
  v_account public.paper_accounts%rowtype;
  v_updated_account public.paper_accounts%rowtype;
  v_equity_lot public.simulated_equity_lots%rowtype;
  v_short_put public.simulated_position_legs%rowtype;
  v_leg_count integer;
  v_expiration_date date := p_expired_at::date;
  v_realized_pnl numeric;
  v_shares integer;
  v_assignment_cost numeric;
  v_cash_after_assignment numeric;
  v_margin_delta numeric;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: Sign in to manage simulated positions.';
  end if;

  select *
  into v_position
  from public.simulated_positions
  where id = p_position_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'SIMULATED_POSITION_NOT_FOUND: Simulated position was not found.';
  end if;

  if v_position.contracts_remaining <= 0 or v_position.status = 'closed' then
    raise exception 'SIMULATED_POSITION_ALREADY_CLOSED: Simulated position is already closed.';
  end if;

  if v_position.expiration_date is not null and v_position.expiration_date > v_expiration_date then
    raise exception 'SIMULATED_POSITION_NOT_EXPIRED: Simulated position has not reached expiration yet.';
  end if;

  select count(*)
  into v_leg_count
  from public.simulated_position_legs
  where position_id = v_position.id;

  select *
  into v_short_put
  from public.simulated_position_legs
  where position_id = v_position.id
    and side = 'short'
    and option_type = 'put'
    and strike is not null
  order by leg_index
  limit 1;

  if v_leg_count <> 1 or v_short_put.id is null then
    update public.simulated_positions
    set status = 'manual_review'
    where id = v_position.id
      and user_id = v_user_id
    returning * into v_updated_position;

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
      v_position.paper_account_id,
      v_position.id,
      'manual_adjustment',
      v_position.contracts_remaining,
      0,
      0,
      0,
      0,
      jsonb_build_object(
        'expiredAt', p_expired_at,
        'notes', p_notes,
        'reason', 'ambiguous_expiration_outcome'
      )
    )
    returning * into v_event;

    return jsonb_build_object(
      'outcome', 'manual_review',
      'position', to_jsonb(v_updated_position),
      'event', to_jsonb(v_event)
    );
  end if;

  v_realized_pnl := v_position.net_credit * v_position.contracts_remaining * 100;

  if p_underlying_price_at_expiration >= v_short_put.strike then
    update public.simulated_positions
    set closed_at = p_expired_at,
        contracts_remaining = 0,
        status = 'closed'
    where id = v_position.id
      and user_id = v_user_id
    returning * into v_updated_position;

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
      v_position.paper_account_id,
      v_position.id,
      'expired',
      v_position.contracts_remaining,
      0,
      0,
      v_realized_pnl,
      0,
      jsonb_build_object(
        'expiredAt', p_expired_at,
        'notes', p_notes,
        'outcome', 'expired_otm',
        'underlyingPriceAtExpiration', p_underlying_price_at_expiration
      )
    )
    returning * into v_event;

    return jsonb_build_object(
      'outcome', 'expired_otm',
      'position', to_jsonb(v_updated_position),
      'event', to_jsonb(v_event)
    );
  end if;

  select *
  into v_account
  from public.paper_accounts
  where id = v_position.paper_account_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'SIMULATED_PAPER_ACCOUNT_NOT_FOUND: Paper account was not found.';
  end if;

  v_shares := v_position.contracts_remaining * 100;
  v_assignment_cost := v_short_put.strike * v_shares;
  v_cash_after_assignment := v_account.current_cash - v_assignment_cost;
  v_margin_delta := greatest(0, -v_cash_after_assignment);

  update public.simulated_positions
  set closed_at = p_expired_at,
      contracts_remaining = 0,
      status = 'assigned'
  where id = v_position.id
    and user_id = v_user_id
  returning * into v_updated_position;

  update public.paper_accounts
  set current_cash = greatest(0, v_cash_after_assignment),
      margin_balance = v_account.margin_balance + v_margin_delta
  where id = v_account.id
    and user_id = v_user_id
  returning * into v_updated_account;

  insert into public.simulated_equity_lots (
    user_id,
    paper_account_id,
    symbol,
    shares,
    cost_basis,
    source_position_id,
    acquired_at
  )
  values (
    v_user_id,
    v_position.paper_account_id,
    v_position.symbol,
    v_shares,
    v_short_put.strike,
    v_position.id,
    p_expired_at
  )
  returning * into v_equity_lot;

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
    v_position.paper_account_id,
    v_position.id,
    'assigned',
    v_position.contracts_remaining,
    v_short_put.strike,
    -v_assignment_cost,
    v_realized_pnl,
    v_margin_delta,
    jsonb_build_object(
      'assignmentCost', v_assignment_cost,
      'costBasis', v_short_put.strike,
      'expiredAt', p_expired_at,
      'notes', p_notes,
      'shares', v_shares,
      'underlyingPriceAtExpiration', p_underlying_price_at_expiration
    )
  )
  returning * into v_event;

  return jsonb_build_object(
    'outcome', 'assigned_put',
    'account', to_jsonb(v_updated_account),
    'equityLot', to_jsonb(v_equity_lot),
    'position', to_jsonb(v_updated_position),
    'event', to_jsonb(v_event)
  );
end;
$$;

grant execute on function public.open_simulated_position_atomic(jsonb) to authenticated;
grant execute on function public.close_simulated_position_atomic(uuid, numeric, integer, timestamptz, text) to authenticated;
grant execute on function public.expire_simulated_position_atomic(uuid, numeric, timestamptz, text) to authenticated;
