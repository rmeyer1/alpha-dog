alter table public.simulated_positions
  drop constraint if exists simulated_positions_status_valid;

alter table public.simulated_positions
  add constraint simulated_positions_status_valid check (
    status in (
      'open',
      'partially_closed',
      'closed',
      'expired',
      'assigned',
      'called_away',
      'manual_review'
    )
  );

alter table public.simulated_position_events
  drop constraint if exists simulated_position_events_type_valid;

alter table public.simulated_position_events
  add constraint simulated_position_events_type_valid check (
    event_type in (
      'opened',
      'partial_close',
      'full_close',
      'expired',
      'assigned',
      'called_away',
      'cash_adjustment',
      'margin_interest',
      'manual_adjustment',
      'mark_update'
    )
  );

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
  v_short_call public.simulated_position_legs%rowtype;
  v_leg_count integer;
  v_callable_lot_count integer;
  v_expiration_date date := p_expired_at::date;
  v_manual_review_reason text := null;
  v_realized_pnl numeric;
  v_shares numeric;
  v_assignment_cost numeric;
  v_cash_after_assignment numeric;
  v_margin_delta numeric;
  v_called_away_proceeds numeric;
  v_lot_cost_basis numeric;
  v_previous_lot_shares numeric;
  v_remaining_lot_shares numeric;
  v_stock_realized_pnl numeric;
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

  select *
  into v_short_call
  from public.simulated_position_legs
  where position_id = v_position.id
    and side = 'short'
    and option_type = 'call'
    and strike is not null
  order by leg_index
  limit 1;

  v_realized_pnl := v_position.net_credit * v_position.contracts_remaining * 100;

  if v_leg_count = 1 and v_short_put.id is not null then
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
  elsif v_leg_count = 1 and
      v_position.strategy_type = 'covered_call' and
      v_short_call.id is not null then
    if p_underlying_price_at_expiration <= v_short_call.strike then
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
          'strategyType', 'covered_call',
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

    v_shares := v_position.contracts_remaining * 100;

    select count(*)
    into v_callable_lot_count
    from public.simulated_equity_lots
    where user_id = v_user_id
      and paper_account_id = v_position.paper_account_id
      and symbol = v_position.symbol
      and shares >= v_shares;

    if v_callable_lot_count = 1 then
      select *
      into v_equity_lot
      from public.simulated_equity_lots
      where user_id = v_user_id
        and paper_account_id = v_position.paper_account_id
        and symbol = v_position.symbol
        and shares >= v_shares
      order by acquired_at, id
      limit 1
      for update;

      select *
      into v_account
      from public.paper_accounts
      where id = v_position.paper_account_id
        and user_id = v_user_id
      for update;

      if not found then
        raise exception 'SIMULATED_PAPER_ACCOUNT_NOT_FOUND: Paper account was not found.';
      end if;

      v_previous_lot_shares := v_equity_lot.shares;
      v_remaining_lot_shares := v_previous_lot_shares - v_shares;
      v_called_away_proceeds := v_short_call.strike * v_shares;
      v_lot_cost_basis := v_equity_lot.cost_basis * v_shares;
      v_stock_realized_pnl := v_called_away_proceeds - v_lot_cost_basis;
      v_realized_pnl := v_realized_pnl + v_stock_realized_pnl;

      update public.simulated_positions
      set closed_at = p_expired_at,
          contracts_remaining = 0,
          status = 'called_away'
      where id = v_position.id
        and user_id = v_user_id
      returning * into v_updated_position;

      update public.paper_accounts
      set current_cash = v_account.current_cash + v_called_away_proceeds,
          margin_balance = v_account.margin_balance
      where id = v_account.id
        and user_id = v_user_id
      returning * into v_updated_account;

      if v_remaining_lot_shares > 0 then
        update public.simulated_equity_lots
        set shares = v_remaining_lot_shares
        where id = v_equity_lot.id
          and user_id = v_user_id;
      else
        delete from public.simulated_equity_lots
        where id = v_equity_lot.id
          and user_id = v_user_id;
      end if;

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
        'called_away',
        v_position.contracts_remaining,
        v_short_call.strike,
        v_called_away_proceeds,
        v_realized_pnl,
        0,
        jsonb_build_object(
          'calledAwayAt', p_expired_at,
          'calledAwayPrice', v_short_call.strike,
          'calledAwayProceeds', v_called_away_proceeds,
          'costBasis', v_equity_lot.cost_basis,
          'expiredAt', p_expired_at,
          'lotCostBasis', v_lot_cost_basis,
          'notes', p_notes,
          'remainingLotShares', v_remaining_lot_shares,
          'shares', v_shares,
          'sourceLotId', v_equity_lot.id,
          'sourcePositionId', v_equity_lot.source_position_id,
          'stockRealizedPnl', v_stock_realized_pnl,
          'underlyingPriceAtExpiration', p_underlying_price_at_expiration
        )
      )
      returning * into v_event;

      return jsonb_build_object(
        'outcome', 'called_away',
        'account', to_jsonb(v_updated_account),
        'equityLot', to_jsonb(v_equity_lot),
        'position', to_jsonb(v_updated_position),
        'event', to_jsonb(v_event)
      );
    elsif v_callable_lot_count = 0 then
      v_manual_review_reason := 'missing_called_away_lot_context';
    else
      v_manual_review_reason := 'ambiguous_called_away_lot_context';
    end if;
  else
    v_manual_review_reason := 'ambiguous_expiration_outcome';
  end if;

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
      'reason', coalesce(v_manual_review_reason, 'ambiguous_expiration_outcome')
    )
  )
  returning * into v_event;

  return jsonb_build_object(
    'outcome', 'manual_review',
    'position', to_jsonb(v_updated_position),
    'event', to_jsonb(v_event)
  );
end;
$$;

grant execute on function public.expire_simulated_position_atomic(uuid, numeric, timestamptz, text) to authenticated;
