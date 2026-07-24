\set ON_ERROR_STOP on
\pset pager off
\timing on

begin;
set local synchronous_commit = off;

create temp table ad011_benchmark_samples (
  duration_ms numeric not null,
  operation text not null
);
grant insert, select on ad011_benchmark_samples to authenticated;

insert into auth.users (id, email)
values
  ('10000000-0000-4000-8000-000000000001', 'ad011-plan-target@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'ad011-plan-unrelated@example.test');

insert into public.account_profiles (
  id,
  email,
  first_name,
  last_name
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'ad011-plan-target@example.test',
    'Plan',
    'Target'
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'ad011-plan-unrelated@example.test',
    'Plan',
    'Unrelated'
  );

insert into public.paper_accounts (
  id,
  user_id,
  starting_cash,
  current_cash,
  margin_balance,
  margin_interest_rate
)
values
  (
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    100000,
    100000,
    0,
    0.05
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    100000,
    100000,
    0,
    0.05
  );

insert into public.simulated_positions (
  id,
  user_id,
  paper_account_id,
  status,
  strategy_type,
  symbol,
  opened_at,
  closed_at,
  contracts_opened,
  contracts_remaining,
  net_credit,
  underlying_price_at_open,
  expiration_date,
  data_source_mode,
  created_at,
  updated_at
)
select
  (
    substr(md5('target-history-' || sequence), 1, 8) || '-' ||
    substr(md5('target-history-' || sequence), 9, 4) || '-4' ||
    substr(md5('target-history-' || sequence), 14, 3) || '-8' ||
    substr(md5('target-history-' || sequence), 18, 3) || '-' ||
    substr(md5('target-history-' || sequence), 21, 12)
  )::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  case when sequence % 2 = 0 then 'closed' else 'expired' end,
  'short_put',
  'PLAN',
  '2026-07-01T16:00:00Z'::timestamptz - sequence * interval '1 second',
  '2026-07-02T16:00:00Z'::timestamptz - sequence * interval '1 second',
  1,
  0,
  1.25,
  30,
  '2026-08-21',
  'demo',
  '2026-07-01T16:00:00Z'::timestamptz - sequence * interval '1 second',
  '2026-07-02T16:00:00Z'::timestamptz - sequence * interval '1 second'
from generate_series(1, 10000) as sequence;

insert into public.simulated_positions (
  id,
  user_id,
  paper_account_id,
  status,
  strategy_type,
  symbol,
  opened_at,
  contracts_opened,
  contracts_remaining,
  net_credit,
  underlying_price_at_open,
  expiration_date,
  data_source_mode,
  created_at,
  updated_at
)
select
  (
    substr(md5('target-open-' || sequence), 1, 8) || '-' ||
    substr(md5('target-open-' || sequence), 9, 4) || '-4' ||
    substr(md5('target-open-' || sequence), 14, 3) || '-8' ||
    substr(md5('target-open-' || sequence), 18, 3) || '-' ||
    substr(md5('target-open-' || sequence), 21, 12)
  )::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  case when sequence % 2 = 0 then 'open' else 'partially_closed' end,
  'short_put',
  'OPEN',
  '2026-07-03T16:00:00Z'::timestamptz - sequence * interval '1 second',
  1,
  1,
  1.25,
  30,
  '2026-08-21',
  'demo',
  '2026-07-03T16:00:00Z'::timestamptz - sequence * interval '1 second',
  '2026-07-03T16:00:00Z'::timestamptz - sequence * interval '1 second'
from generate_series(1, 200) as sequence;

insert into public.simulated_positions (
  id,
  user_id,
  paper_account_id,
  status,
  strategy_type,
  symbol,
  opened_at,
  closed_at,
  contracts_opened,
  contracts_remaining,
  net_credit,
  underlying_price_at_open,
  expiration_date,
  data_source_mode,
  created_at,
  updated_at
)
select
  (
    substr(md5('unrelated-history-' || sequence), 1, 8) || '-' ||
    substr(md5('unrelated-history-' || sequence), 9, 4) || '-4' ||
    substr(md5('unrelated-history-' || sequence), 14, 3) || '-8' ||
    substr(md5('unrelated-history-' || sequence), 18, 3) || '-' ||
    substr(md5('unrelated-history-' || sequence), 21, 12)
  )::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid,
  '20000000-0000-4000-8000-000000000002'::uuid,
  'closed',
  'short_put',
  'OTHER',
  '2026-07-01T16:00:00Z'::timestamptz - sequence * interval '1 second',
  '2026-07-02T16:00:00Z'::timestamptz - sequence * interval '1 second',
  1,
  0,
  1,
  20,
  '2026-08-21',
  'demo',
  '2026-07-01T16:00:00Z'::timestamptz - sequence * interval '1 second',
  '2026-07-02T16:00:00Z'::timestamptz - sequence * interval '1 second'
from generate_series(1, 20000) as sequence;

insert into public.simulated_position_legs (
  id,
  position_id,
  leg_index,
  side,
  option_type,
  strike,
  expiration_date,
  quantity,
  open_price,
  current_mark,
  snapshot
)
select
  (
    substr(md5('leg-' || position.id), 1, 8) || '-' ||
    substr(md5('leg-' || position.id), 9, 4) || '-4' ||
    substr(md5('leg-' || position.id), 14, 3) || '-8' ||
    substr(md5('leg-' || position.id), 18, 3) || '-' ||
    substr(md5('leg-' || position.id), 21, 12)
  )::uuid,
  position.id,
  0,
  'short',
  'put',
  25,
  '2026-08-21',
  1,
  1.25,
  1.10,
  '{}'::jsonb
from public.simulated_positions as position
where position.user_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

insert into public.simulated_position_events (
  id,
  user_id,
  paper_account_id,
  position_id,
  event_type,
  quantity,
  price,
  cash_delta,
  realized_pnl_delta,
  margin_delta,
  metadata,
  created_at
)
select
  (
    substr(md5('event-' || position.id), 1, 8) || '-' ||
    substr(md5('event-' || position.id), 9, 4) || '-4' ||
    substr(md5('event-' || position.id), 14, 3) || '-8' ||
    substr(md5('event-' || position.id), 18, 3) || '-' ||
    substr(md5('event-' || position.id), 21, 12)
  )::uuid,
  position.user_id,
  position.paper_account_id,
  position.id,
  'opened',
  1,
  position.net_credit,
  position.net_credit * 100,
  0,
  0,
  '{}'::jsonb,
  position.opened_at
from public.simulated_positions as position
where position.user_id in (
  '10000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000002'::uuid
);

insert into public.simulated_position_events (
  id,
  user_id,
  paper_account_id,
  position_id,
  event_type,
  quantity,
  price,
  cash_delta,
  realized_pnl_delta,
  margin_delta,
  metadata,
  created_at
)
select
  (
    substr(md5('detail-event-' || sequence), 1, 8) || '-' ||
    substr(md5('detail-event-' || sequence), 9, 4) || '-4' ||
    substr(md5('detail-event-' || sequence), 14, 3) || '-8' ||
    substr(md5('detail-event-' || sequence), 18, 3) || '-' ||
    substr(md5('detail-event-' || sequence), 21, 12)
  )::uuid,
  position.user_id,
  position.paper_account_id,
  position.id,
  'mark_update',
  null,
  null,
  0,
  0,
  0,
  jsonb_build_object('sequence', sequence),
  '2026-07-04T16:00:00Z'::timestamptz - sequence * interval '1 second'
from generate_series(1, 5000) as sequence
cross join lateral (
  select candidate.*
  from public.simulated_positions as candidate
  where candidate.user_id =
    '10000000-0000-4000-8000-000000000001'::uuid
  order by candidate.opened_at desc, candidate.id desc
  limit 1
) as position;

analyze public.simulated_positions;
analyze public.simulated_position_legs;
analyze public.simulated_position_events;

\echo 'AD-011 seed cardinalities'
select
  count(*) filter (
    where user_id = '10000000-0000-4000-8000-000000000001'::uuid
  ) as target_positions,
  count(*) filter (
    where user_id = '10000000-0000-4000-8000-000000000002'::uuid
  ) as unrelated_positions
from public.simulated_positions;
select count(*) as target_events
from public.simulated_position_events
where user_id = '10000000-0000-4000-8000-000000000001'::uuid;

select position.id as detail_position_id
from public.simulated_positions as position
where position.user_id =
  '10000000-0000-4000-8000-000000000001'::uuid
order by position.opened_at desc, position.id desc
limit 1
\gset

select set_config('ad011.detail_position_id', :'detail_position_id', true);

set local role authenticated;
set local "request.jwt.claim.sub" =
  '10000000-0000-4000-8000-000000000001';

\echo 'AD-011 first open page'
explain (analyze, buffers, format text)
select position.id, position.opened_at
from public.simulated_positions as position
where position.user_id = (select auth.uid())
  and position.status in ('open', 'partially_closed')
order by position.opened_at desc, position.id desc
limit 26;

\echo 'AD-011 middle open page'
explain (analyze, buffers, format text)
select position.id, position.opened_at
from public.simulated_positions as position
where position.user_id = (select auth.uid())
  and position.status in ('open', 'partially_closed')
  and (position.opened_at, position.id) < (
    '2026-07-03T15:58:20Z'::timestamptz,
    'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
  )
order by position.opened_at desc, position.id desc
limit 26;

\echo 'AD-011 first history page'
explain (analyze, buffers, format text)
select position.id, position.opened_at
from public.simulated_positions as position
where position.user_id = (select auth.uid())
  and position.status in (
    'assigned',
    'called_away',
    'closed',
    'expired',
    'manual_review'
  )
order by position.opened_at desc, position.id desc
limit 26;

\echo 'AD-011 middle history page'
explain (analyze, buffers, format text)
select position.id, position.opened_at
from public.simulated_positions as position
where position.user_id = (select auth.uid())
  and position.status in (
    'assigned',
    'called_away',
    'closed',
    'expired',
    'manual_review'
  )
  and (position.opened_at, position.id) < (
    '2026-07-01T14:36:40Z'::timestamptz,
    'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
  )
order by position.opened_at desc, position.id desc
limit 26;

\echo 'AD-011 first event page'
explain (analyze, buffers, format text)
select event.id, event.created_at
from public.simulated_position_events as event
where event.position_id = :'detail_position_id'::uuid
  and event.user_id = (select auth.uid())
order by event.created_at desc, event.id desc
limit 51;

\echo 'AD-011 middle event page'
explain (analyze, buffers, format text)
select event.id, event.created_at
from public.simulated_position_events as event
where event.position_id = :'detail_position_id'::uuid
  and event.user_id = (select auth.uid())
  and (event.created_at, event.id) < (
    '2026-07-04T15:18:20Z'::timestamptz,
    'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
  )
order by event.created_at desc, event.id desc
limit 51;

\echo 'AD-011 middle history page RPC'
explain (analyze, buffers, format text)
select id, opened_at
from public.get_paper_account_position_page(
  'history',
  26,
  '2026-07-01T14:36:40Z'::timestamptz,
  'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
);

\echo 'AD-011 middle event page RPC'
explain (analyze, buffers, format text)
select id, created_at
from public.get_simulated_position_event_page(
  :'detail_position_id'::uuid,
  51,
  '2026-07-04T15:18:20Z'::timestamptz,
  'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
);

\echo 'AD-011 account aggregate'
explain (analyze, buffers, format text)
select *
from public.get_paper_account_portfolio_summary();

\echo 'AD-011 server median and p95'
do $$
declare
  iteration integer;
  started_at timestamptz;
begin
  for iteration in 1..100 loop
    started_at := clock_timestamp();
    perform count(*)
    from public.get_paper_account_position_page(
      'history',
      26,
      '2026-07-01T14:36:40Z'::timestamptz,
      'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
    );
    insert into ad011_benchmark_samples (duration_ms, operation)
    values (
      extract(epoch from (clock_timestamp() - started_at)) * 1000,
      'history-middle'
    );

    started_at := clock_timestamp();
    perform count(*)
    from public.get_simulated_position_event_page(
      current_setting('ad011.detail_position_id')::uuid,
      51,
      '2026-07-04T15:18:20Z'::timestamptz,
      'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid
    );
    insert into ad011_benchmark_samples (duration_ms, operation)
    values (
      extract(epoch from (clock_timestamp() - started_at)) * 1000,
      'event-middle'
    );
  end loop;

  for iteration in 1..30 loop
    started_at := clock_timestamp();
    perform count(*)
    from public.get_paper_account_portfolio_summary();
    insert into ad011_benchmark_samples (duration_ms, operation)
    values (
      extract(epoch from (clock_timestamp() - started_at)) * 1000,
      'aggregate'
    );
  end loop;
end;
$$;

select
  operation,
  count(*) as samples,
  round(
    percentile_cont(0.5) within group (order by duration_ms)::numeric,
    3
  ) as median_ms,
  round(
    percentile_cont(0.95) within group (order by duration_ms)::numeric,
    3
  ) as p95_ms
from ad011_benchmark_samples
group by operation
order by operation;

\echo 'AD-011 bounded first-page payload bytes'
select octet_length(coalesce(jsonb_agg(page)::text, '[]')) as payload_bytes
from (
  select position.id, position.opened_at, position.status, position.symbol
  from public.simulated_positions as position
  where position.user_id = (select auth.uid())
    and position.status in (
      'assigned',
      'called_away',
      'closed',
      'expired',
      'manual_review'
    )
  order by position.opened_at desc, position.id desc
  limit 25
) as page;

rollback;
