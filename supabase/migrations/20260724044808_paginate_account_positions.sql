create index if not exists simulated_positions_open_page_idx
  on public.simulated_positions (user_id, opened_at desc, id desc)
  where status in ('open', 'partially_closed');

create index if not exists simulated_positions_history_page_idx
  on public.simulated_positions (user_id, opened_at desc, id desc)
  where status in (
    'assigned',
    'called_away',
    'closed',
    'expired',
    'manual_review'
  );

create index if not exists simulated_position_events_detail_page_idx
  on public.simulated_position_events (position_id, created_at desc, id desc);

create index if not exists simulated_position_events_lifecycle_page_idx
  on public.simulated_position_events (position_id, created_at desc, id desc)
  where event_type in (
    'assigned',
    'called_away',
    'expired',
    'manual_adjustment'
  );

create or replace function public.get_paper_account_position_page(
  p_scope text,
  p_page_size integer,
  p_sort_at timestamptz default null,
  p_position_id uuid default null
)
returns setof public.simulated_positions
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_scope not in ('open', 'history') then
    raise exception 'INVALID_POSITION_SCOPE: Position scope is invalid.';
  end if;

  if p_page_size < 1 or p_page_size > 101 then
    raise exception 'INVALID_POSITION_PAGE: Position page must contain 1 to 101 rows.';
  end if;

  if (p_sort_at is null) <> (p_position_id is null) then
    raise exception 'INVALID_POSITION_CURSOR: Position cursor tuple is incomplete.';
  end if;

  if p_scope = 'open' then
    return query
    select position.*
    from public.simulated_positions as position
    where position.user_id = (select auth.uid())
      and position.status in ('open', 'partially_closed')
      and (
        p_sort_at is null or
        (position.opened_at, position.id) < (p_sort_at, p_position_id)
      )
    order by position.opened_at desc, position.id desc
    limit p_page_size;
  else
    return query
    select position.*
    from public.simulated_positions as position
    where position.user_id = (select auth.uid())
      and position.status in (
        'assigned',
        'called_away',
        'closed',
        'expired',
        'manual_review'
      )
      and (
        p_sort_at is null or
        (position.opened_at, position.id) < (p_sort_at, p_position_id)
      )
    order by position.opened_at desc, position.id desc
    limit p_page_size;
  end if;
end;
$$;

create or replace function public.get_simulated_position_event_page(
  p_position_id uuid,
  p_page_size integer,
  p_sort_at timestamptz default null,
  p_event_id uuid default null
)
returns setof public.simulated_position_events
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_page_size < 1 or p_page_size > 101 then
    raise exception 'INVALID_EVENT_PAGE: Event page must contain 1 to 101 rows.';
  end if;

  if (p_sort_at is null) <> (p_event_id is null) then
    raise exception 'INVALID_EVENT_CURSOR: Event cursor tuple is incomplete.';
  end if;

  return query
  select event.*
  from public.simulated_position_events as event
  where event.position_id = p_position_id
    and event.user_id = (select auth.uid())
    and (
      p_sort_at is null or
      (event.created_at, event.id) < (p_sort_at, p_event_id)
    )
  order by event.created_at desc, event.id desc
  limit p_page_size;
end;
$$;

create or replace function public.get_latest_simulated_position_lifecycle_events(
  p_position_ids uuid[]
)
returns setof public.simulated_position_events
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce(cardinality(p_position_ids), 0) < 1 or
      cardinality(p_position_ids) > 100 then
    raise exception
      'INVALID_POSITION_PAGE: Position lifecycle page must contain 1 to 100 IDs.';
  end if;

  return query
  select distinct on (event.position_id)
    event.*
  from public.simulated_position_events as event
  where event.position_id = any(p_position_ids)
    and event.user_id = (select auth.uid())
    and event.event_type in (
      'assigned',
      'called_away',
      'expired',
      'manual_adjustment'
    )
  order by event.position_id, event.created_at desc, event.id desc;
end;
$$;

create or replace function public.get_paper_account_portfolio_summary()
returns table (
  cash_balance numeric,
  history_position_count bigint,
  margin_balance numeric,
  margin_interest_accrued numeric,
  margin_interest_rate numeric,
  open_exposure numeric,
  open_position_count bigint,
  position_watermark timestamptz,
  realized_pnl numeric,
  total_premium_collected numeric,
  unrealized_pnl numeric,
  unrealized_pnl_status text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with
  caller as (
    select auth.uid() as user_id
  ),
  account as (
    select
      paper_account.margin_balance,
      paper_account.margin_interest_rate,
      paper_account.starting_cash
    from public.paper_accounts as paper_account
    where paper_account.user_id = (select caller.user_id from caller)
    limit 1
  ),
  event_totals as (
    select
      coalesce(sum(event.cash_delta), 0::numeric) as cash_delta,
      coalesce(sum(event.margin_delta), 0::numeric) as margin_delta,
      coalesce(
        sum(abs(event.cash_delta))
          filter (where event.event_type = 'margin_interest'),
        0::numeric
      ) as margin_interest_accrued,
      coalesce(sum(event.realized_pnl_delta), 0::numeric) as realized_pnl,
      coalesce(
        sum(greatest(event.cash_delta, 0::numeric))
          filter (where event.event_type = 'opened'),
        0::numeric
      ) as total_premium_collected
    from public.simulated_position_events as event
    where event.user_id = (select caller.user_id from caller)
  ),
  position_legs as (
    select
      position.id as position_id,
      count(leg.id) as leg_count,
      bool_or(
        coalesce(
          leg.current_mark,
          leg.mid_price,
          case
            when leg.bid_price is not null and leg.ask_price is not null
              then (leg.bid_price + leg.ask_price) / 2
            else null
          end
        ) is null
      ) filter (where leg.id is not null) as has_unavailable_mark,
      coalesce(
        sum(
          coalesce(
            leg.current_mark,
            leg.mid_price,
            case
              when leg.bid_price is not null and leg.ask_price is not null
                then (leg.bid_price + leg.ask_price) / 2
              else null
            end
          ) *
          (leg.quantity::numeric / position.contracts_opened::numeric) *
          case when leg.side = 'short' then 1 else -1 end
        ),
        0::numeric
      ) as mark_to_close_per_contract,
      (
        array_agg(leg.strike order by leg.leg_index)
          filter (
            where leg.side = 'short'
              and leg.option_type = 'put'
              and leg.strike is not null
          )
      )[1] as short_put_strike,
      (
        array_agg(leg.strike order by leg.leg_index)
          filter (where leg.side = 'short' and leg.strike is not null)
      )[1] as short_strike,
      (
        array_agg(leg.strike order by leg.leg_index)
          filter (where leg.side = 'long' and leg.strike is not null)
      )[1] as long_strike
    from public.simulated_positions as position
    left join public.simulated_position_legs as leg
      on leg.position_id = position.id
    where position.user_id = (select caller.user_id from caller)
    group by position.id
  ),
  position_values as (
    select
      position.id,
      case
        when position.contracts_remaining <= 0 or position.status = 'closed'
          then 0::numeric
        when position.strategy_type like '%\_spread' escape '\' then
          round(
            coalesce(abs(legs.short_strike - legs.long_strike), 0::numeric) *
              position.contracts_remaining *
              100,
            2
          )
        when legs.short_put_strike is not null then
          round(
            legs.short_put_strike * position.contracts_remaining * 100,
            2
          )
        else 0::numeric
      end as open_exposure,
      case
        when position.contracts_remaining <= 0 or position.status = 'closed'
          then false
        else coalesce(legs.has_unavailable_mark, false)
      end as unavailable,
      case
        when position.contracts_remaining <= 0 or position.status = 'closed'
          then 0::numeric
        when coalesce(legs.has_unavailable_mark, false)
          then null
        else round(
          round(
            position.net_credit * position.contracts_remaining * 100,
            2
          ) -
          round(
            legs.mark_to_close_per_contract *
              position.contracts_remaining *
              100,
            2
          ),
          2
        )
      end as unrealized_pnl
    from public.simulated_positions as position
    join position_legs as legs
      on legs.position_id = position.id
    where position.user_id = (select caller.user_id from caller)
  ),
  position_totals as (
    select
      count(*) filter (
        where position.status in ('open', 'partially_closed')
      ) as open_position_count,
      count(*) filter (
        where position.status in (
          'assigned',
          'called_away',
          'closed',
          'expired',
          'manual_review'
        )
      ) as history_position_count,
      coalesce(sum(value.open_exposure), 0::numeric) as open_exposure,
      coalesce(bool_or(value.unavailable), false) as has_unavailable_mark,
      case
        when coalesce(bool_or(value.unavailable), false) then null
        else round(coalesce(sum(value.unrealized_pnl), 0::numeric), 2)
      end as unrealized_pnl,
      coalesce(max(position.updated_at), '1970-01-01T00:00:00Z'::timestamptz)
        as position_watermark
    from public.simulated_positions as position
    join position_values as value
      on value.id = position.id
    where position.user_id = (select caller.user_id from caller)
  )
  select
    round(account.starting_cash + event_totals.cash_delta, 2)
      as cash_balance,
    position_totals.history_position_count,
    round(account.margin_balance + event_totals.margin_delta, 2)
      as margin_balance,
    round(event_totals.margin_interest_accrued, 2)
      as margin_interest_accrued,
    account.margin_interest_rate,
    round(position_totals.open_exposure, 2) as open_exposure,
    position_totals.open_position_count,
    position_totals.position_watermark,
    round(event_totals.realized_pnl, 2) as realized_pnl,
    round(event_totals.total_premium_collected, 2)
      as total_premium_collected,
    position_totals.unrealized_pnl,
    case
      when position_totals.has_unavailable_mark then 'unavailable'
      else 'available'
    end as unrealized_pnl_status
  from account
  cross join event_totals
  cross join position_totals;
$$;

revoke all on function public.get_latest_simulated_position_lifecycle_events(
  uuid[]
) from public, anon, authenticated, service_role;
revoke all on function public.get_paper_account_position_page(
  text,
  integer,
  timestamptz,
  uuid
) from public, anon, authenticated, service_role;
revoke all on function public.get_paper_account_portfolio_summary()
  from public, anon, authenticated, service_role;
revoke all on function public.get_simulated_position_event_page(
  uuid,
  integer,
  timestamptz,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.get_latest_simulated_position_lifecycle_events(
  uuid[]
) to authenticated;
grant execute on function public.get_paper_account_position_page(
  text,
  integer,
  timestamptz,
  uuid
) to authenticated;
grant execute on function public.get_paper_account_portfolio_summary()
  to authenticated;
grant execute on function public.get_simulated_position_event_page(
  uuid,
  integer,
  timestamptz,
  uuid
) to authenticated;
