begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

with batch_tables(table_name) as (
  values
    ('wheel_market_batches'),
    ('wheel_market_batch_underlyings'),
    ('wheel_market_batch_option_contracts'),
    ('wheel_market_batch_option_ingestions'),
    ('wheel_market_batch_snapshots'),
    ('wheel_market_batch_candidates'),
    ('wheel_market_batch_current_snapshots'),
    ('wheel_market_batch_metrics')
)
select ok(
  c.relrowsecurity and c.relforcerowsecurity,
  format('public.%I has forced RLS', batch_tables.table_name)
)
from batch_tables
join pg_class c
  on c.relname = batch_tables.table_name
join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by batch_tables.table_name;

with
batch_tables(table_name) as (
  values
    ('wheel_market_batches'),
    ('wheel_market_batch_underlyings'),
    ('wheel_market_batch_option_contracts'),
    ('wheel_market_batch_option_ingestions'),
    ('wheel_market_batch_snapshots'),
    ('wheel_market_batch_candidates'),
    ('wheel_market_batch_current_snapshots'),
    ('wheel_market_batch_metrics')
),
untrusted_roles(role_name) as (
  values ('anon'), ('authenticated')
),
operations(operation) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
select ok(
  not has_table_privilege(
    role_name,
    format('public.%I', table_name),
    operation
  ),
  format('%s cannot %s public.%I', role_name, operation, table_name)
)
from batch_tables
cross join untrusted_roles
cross join operations
order by table_name, role_name, operation;

with
batch_tables(table_name) as (
  values
    ('wheel_market_batches'),
    ('wheel_market_batch_underlyings'),
    ('wheel_market_batch_option_contracts'),
    ('wheel_market_batch_option_ingestions'),
    ('wheel_market_batch_snapshots'),
    ('wheel_market_batch_candidates'),
    ('wheel_market_batch_current_snapshots'),
    ('wheel_market_batch_metrics')
),
operations(operation) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
)
select ok(
  has_table_privilege(
    'service_role',
    format('public.%I', table_name),
    operation
  ),
  format('service_role can %s public.%I', operation, table_name)
)
from batch_tables
cross join operations
order by table_name, operation;

with
functions(signature) as (
  values
    ('public.create_wheel_market_batch(text,timestamp with time zone,text)'),
    ('public.complete_wheel_market_batch_facts(uuid,integer,integer,integer,integer,integer,jsonb)'),
    ('public.checkpoint_wheel_market_batch_underlyings(uuid,integer,integer,integer,jsonb)'),
    ('public.create_wheel_market_batch_snapshot(uuid,text,text,text,jsonb,text,integer,timestamp with time zone,timestamp with time zone)'),
    ('public.publish_wheel_market_batch_snapshot(uuid,integer,integer,integer,jsonb,jsonb)'),
    ('public.complete_wheel_market_batch(uuid,integer)'),
    ('public.fail_wheel_market_batch(uuid,text)'),
    ('public.prune_wheel_market_batch_history(timestamp with time zone)')
),
untrusted_roles(role_name) as (
  values ('anon'), ('authenticated')
)
select ok(
  not has_function_privilege(role_name, signature, 'EXECUTE'),
  format('%s cannot execute %s', role_name, signature)
)
from functions
cross join untrusted_roles
order by signature, role_name;

with functions(signature) as (
  values
    ('public.create_wheel_market_batch(text,timestamp with time zone,text)'),
    ('public.complete_wheel_market_batch_facts(uuid,integer,integer,integer,integer,integer,jsonb)'),
    ('public.checkpoint_wheel_market_batch_underlyings(uuid,integer,integer,integer,jsonb)'),
    ('public.create_wheel_market_batch_snapshot(uuid,text,text,text,jsonb,text,integer,timestamp with time zone,timestamp with time zone)'),
    ('public.publish_wheel_market_batch_snapshot(uuid,integer,integer,integer,jsonb,jsonb)'),
    ('public.complete_wheel_market_batch(uuid,integer)'),
    ('public.fail_wheel_market_batch(uuid,text)'),
    ('public.prune_wheel_market_batch_history(timestamp with time zone)')
)
select ok(
  has_function_privilege('service_role', signature, 'EXECUTE'),
  format('service_role can execute %s', signature)
)
from functions
order by signature;

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'create_wheel_market_batch',
        'complete_wheel_market_batch_facts',
        'checkpoint_wheel_market_batch_underlyings',
        'create_wheel_market_batch_snapshot',
        'publish_wheel_market_batch_snapshot',
        'complete_wheel_market_batch',
        'fail_wheel_market_batch',
        'prune_wheel_market_batch_history'
      ])
      and not p.prosecdef
      and p.proconfig = array['search_path=""']
  ),
  8,
  'all batch RPCs are invoker-security with an empty search path'
);

create temporary table test_market_batch_ids (
  name text primary key,
  id uuid not null
) on commit drop;

insert into test_market_batch_ids (name, id)
select
  'first_batch',
  (public.create_wheel_market_batch(
    '2026-07-27T20:00:00Z:opra:first',
    '2026-07-27T20:00:00Z'::timestamptz,
    'opra'
  )->>'batch_id')::uuid;

insert into test_market_batch_ids (name, id)
select
  'same_interval_batch',
  (public.create_wheel_market_batch(
    '2026-07-27T20:00:00Z:opra:competitor',
    '2026-07-27T20:00:00Z'::timestamptz,
    'opra'
  )->>'batch_id')::uuid;

select is(
  (select id from test_market_batch_ids where name = 'same_interval_batch'),
  (select id from test_market_batch_ids where name = 'first_batch'),
  'competing creation attempts resolve to one canonical interval batch'
);

insert into public.wheel_market_batch_underlyings (
  batch_id,
  symbol,
  company_name,
  exchange,
  universe_rank,
  selected_for_scoring,
  stock_score,
  price,
  dollar_volume,
  stock_snapshot,
  trend,
  earnings_context,
  captured_at
) values (
  (select id from test_market_batch_ids where name = 'first_batch'),
  'AAPL',
  'Apple Inc.',
  'NASDAQ',
  1,
  true,
  100,
  200,
  2000000000,
  '{"dailyBar":{"v":10000000}}'::jsonb,
  'bullish',
  '{"events":[],"providerEnabled":false,"symbol":"AAPL"}'::jsonb,
  '2026-07-27T20:00:10Z'::timestamptz
);

insert into public.wheel_market_batch_option_contracts (
  batch_id,
  contract_symbol,
  underlying_symbol,
  option_type,
  strike,
  expiration,
  bid,
  ask,
  delta,
  implied_volatility,
  volume,
  open_interest,
  captured_at
) values (
  (select id from test_market_batch_ids where name = 'first_batch'),
  'AAPL260821P00190000',
  'AAPL',
  'put',
  190,
  '2026-08-21',
  2.4,
  2.6,
  -0.25,
  0.32,
  200,
  1000,
  '2026-07-27T20:00:10Z'::timestamptz
);

insert into public.wheel_market_batch_option_ingestions (
  batch_id,
  symbol,
  option_type,
  status,
  contract_count,
  duration_ms
) values (
  (select id from test_market_batch_ids where name = 'first_batch'),
  'AAPL',
  'put',
  'complete',
  1,
  10
);

select is(
  public.checkpoint_wheel_market_batch_underlyings(
    (select id from test_market_batch_ids where name = 'first_batch'),
    1,
    1,
    1,
    '{"selectedSymbols":["AAPL"]}'::jsonb
  )->>'selected_count',
  '1',
  'the underlying checkpoint records the completed shared refresh'
);

select is(
  public.complete_wheel_market_batch_facts(
    (select id from test_market_batch_ids where name = 'first_batch'),
    1,
    1,
    1,
    1,
    0,
    '{"errors":[]}'::jsonb
  )->>'status',
  'facts_ready',
  'a complete persisted fact set advances the batch to facts_ready'
);

insert into test_market_batch_ids (name, id)
select
  'first_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'first_batch'),
    'balanced_wheel',
    'short_put',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T20:00:10Z'::timestamptz,
    '2026-07-27T20:15:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

insert into test_market_batch_ids (name, id)
select
  'replayed_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'first_batch'),
    'balanced_wheel',
    'short_put',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T20:00:10Z'::timestamptz,
    '2026-07-27T20:15:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

select is(
  (select id from test_market_batch_ids where name = 'replayed_snapshot'),
  (select id from test_market_batch_ids where name = 'first_snapshot'),
  'snapshot creation replays return one canonical snapshot'
);

select is(
  (select count(*)::integer from public.wheel_market_batch_current_snapshots),
  0,
  'a building snapshot is invisible before atomic publication'
);

insert into public.wheel_market_batch_candidates (
  snapshot_id,
  rank,
  symbol,
  company_name,
  exchange,
  score,
  strategy,
  option_type,
  expiration,
  dte,
  short_strike,
  premium_received,
  premium_yield,
  annualized_yield,
  delta,
  implied_volatility,
  liquidity_quality,
  warning_count,
  underlying_price,
  underlying_as_of,
  trend,
  warnings,
  errors,
  as_of
) values (
  (select id from test_market_batch_ids where name = 'first_snapshot'),
  1,
  'AAPL',
  'Apple Inc.',
  'NASDAQ',
  88,
  'short_put',
  'put',
  '2026-08-21',
  25,
  190,
  250,
  0.0132,
  0.1927,
  -0.25,
  0.32,
  'excellent',
  0,
  200,
  '2026-07-27T20:00:10Z'::timestamptz,
  'bullish',
  '[]'::jsonb,
  '[]'::jsonb,
  '2026-07-27T20:00:10Z'::timestamptz
);

select throws_ok(
  format(
    'select public.publish_wheel_market_batch_snapshot(%L::uuid, 1, 0, 2, ''[]''::jsonb, ''[]''::jsonb)',
    (select id from test_market_batch_ids where name = 'first_snapshot')
  ),
  'P0001',
  'Wheel market batch candidate count does not match.',
  'publication rejects an incomplete candidate set'
);

select is(
  public.publish_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'first_snapshot'),
    1,
    0,
    1,
    '[]'::jsonb,
    '[]'::jsonb
  )->>'status',
  'complete',
  'a complete snapshot publishes successfully'
);

select is(
  (
    public.publish_wheel_market_batch_snapshot(
      (select id from test_market_batch_ids where name = 'first_snapshot'),
      1,
      0,
      1,
      '[]'::jsonb,
      '[]'::jsonb
    )->>'staged'
  )::boolean,
  false,
  'replaying snapshot completion is idempotent'
);

select is(
  (
    select count(*)::integer
    from public.wheel_market_batch_current_snapshots
  ),
  0,
  'staged consumer snapshots remain invisible until batch completion'
);

select is(
  public.complete_wheel_market_batch(
    (select id from test_market_batch_ids where name = 'first_batch'),
    1
  )->>'status',
  'complete',
  'the batch completes only after all expected snapshots stage'
);

select is(
  (
    select snapshot_id
    from public.wheel_market_batch_current_snapshots
    where persona = 'balanced_wheel'
      and strategy = 'short_put'
  ),
  (select id from test_market_batch_ids where name = 'first_snapshot'),
  'the current pointer references the complete snapshot'
);

insert into test_market_batch_ids (name, id)
select
  'failed_batch',
  (public.create_wheel_market_batch(
    '2026-07-27T20:15:00Z:opra',
    '2026-07-27T20:15:00Z'::timestamptz,
    'opra'
  )->>'batch_id')::uuid;

select ok(
  public.fail_wheel_market_batch(
    (select id from test_market_batch_ids where name = 'failed_batch'),
    'controlled provider failure'
  ),
  'a controlled provider failure marks the replacement batch failed'
);

select is(
  (
    select snapshot_id
    from public.wheel_market_batch_current_snapshots
    where persona = 'balanced_wheel'
      and strategy = 'short_put'
  ),
  (select id from test_market_batch_ids where name = 'first_snapshot'),
  'a failed replacement batch leaves the previous complete snapshot readable'
);

insert into test_market_batch_ids (name, id)
select
  'partial_batch',
  (public.create_wheel_market_batch(
    '2026-07-27T20:20:00Z:opra',
    '2026-07-27T20:20:00Z'::timestamptz,
    'opra'
  )->>'batch_id')::uuid;

update public.wheel_market_batches
set status = 'facts_ready'
where id = (select id from test_market_batch_ids where name = 'partial_batch');

insert into test_market_batch_ids (name, id)
select
  'partial_put_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'partial_batch'),
    'balanced_wheel',
    'short_put',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T20:20:00Z'::timestamptz,
    '2026-07-27T20:35:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

insert into test_market_batch_ids (name, id)
select
  'partial_call_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'partial_batch'),
    'balanced_wheel',
    'covered_call',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T20:20:00Z'::timestamptz,
    '2026-07-27T20:35:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

select is(
  public.publish_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'partial_put_snapshot'),
    0,
    0,
    0,
    '[]'::jsonb,
    '[]'::jsonb
  )->>'status',
  'complete',
  'consumer A may stage before consumer B fails'
);

select throws_ok(
  format(
    'select public.complete_wheel_market_batch(%L::uuid, 2)',
    (select id from test_market_batch_ids where name = 'partial_batch')
  ),
  'P0001',
  'Wheel market batch snapshots are incomplete.',
  'final completion rejects a batch with an unstaged consumer'
);

select ok(
  public.fail_wheel_market_batch(
    (select id from test_market_batch_ids where name = 'partial_batch'),
    'consumer B failed'
  ),
  'a post-stage workflow failure marks the batch failed'
);

select is(
  public.fail_wheel_market_batch(
    (select id from test_market_batch_ids where name = 'partial_batch'),
    'consumer B failed'
  ),
  false,
  'replaying a batch failure is idempotent'
);

select throws_ok(
  format(
    $sql$
      select public.publish_wheel_market_batch_snapshot(
        %L::uuid,
        0,
        0,
        0,
        '[]'::jsonb,
        '[]'::jsonb
      )
    $sql$,
    (select id from test_market_batch_ids where name = 'partial_call_snapshot')
  ),
  'P0001',
  'Wheel market batch is not publishable.',
  'replay cannot stage another consumer after the batch fails'
);

select is(
  (
    select snapshot_id
    from public.wheel_market_batch_current_snapshots
    where persona = 'balanced_wheel'
      and strategy = 'short_put'
  ),
  (select id from test_market_batch_ids where name = 'first_snapshot'),
  'a post-stage failure retains consumer A previous pointer'
);

select is(
  (
    select count(*)::integer
    from public.wheel_market_batch_current_snapshots
    where persona = 'balanced_wheel'
      and strategy = 'covered_call'
  ),
  0,
  'a post-stage failure creates no consumer B pointer'
);

insert into test_market_batch_ids (name, id)
select
  'type_outage_batch',
  (public.create_wheel_market_batch(
    '2026-07-27T20:25:00Z:opra',
    '2026-07-27T20:25:00Z'::timestamptz,
    'opra'
  )->>'batch_id')::uuid;

insert into public.wheel_market_batch_underlyings (
  batch_id,
  symbol,
  company_name,
  exchange,
  universe_rank,
  selected_for_scoring,
  stock_score,
  price,
  stock_snapshot,
  trend,
  earnings_context,
  captured_at
) values (
  (select id from test_market_batch_ids where name = 'type_outage_batch'),
  'MSFT',
  'Microsoft Corp.',
  'NASDAQ',
  1,
  true,
  100,
  500,
  '{}'::jsonb,
  'bullish',
  '{"events":[],"providerEnabled":false,"symbol":"MSFT"}'::jsonb,
  '2026-07-27T20:25:00Z'::timestamptz
);

insert into public.wheel_market_batch_option_ingestions (
  batch_id,
  symbol,
  option_type,
  status,
  contract_count,
  error,
  duration_ms
) values
(
  (select id from test_market_batch_ids where name = 'type_outage_batch'),
  'MSFT',
  'put',
  'complete',
  0,
  null,
  10
),
(
  (select id from test_market_batch_ids where name = 'type_outage_batch'),
  'MSFT',
  'call',
  'failed',
  0,
  'provider unavailable',
  10
);

update public.wheel_market_batches
set status = 'facts_ready', selected_count = 1
where id = (
  select id
  from test_market_batch_ids
  where name = 'type_outage_batch'
);

insert into test_market_batch_ids (name, id)
select
  'type_outage_put_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'type_outage_batch'),
    'balanced_wheel',
    'short_put',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T20:25:00Z'::timestamptz,
    '2026-07-27T20:40:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

insert into test_market_batch_ids (name, id)
select
  'type_outage_call_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'type_outage_batch'),
    'balanced_wheel',
    'covered_call',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T20:25:00Z'::timestamptz,
    '2026-07-27T20:40:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

select public.publish_wheel_market_batch_snapshot(
  ids.id,
  1,
  1,
  0,
  '[]'::jsonb,
  '[]'::jsonb
)
from test_market_batch_ids as ids
where ids.name in ('type_outage_put_snapshot', 'type_outage_call_snapshot')
order by ids.name;

select throws_ok(
  format(
    'select public.complete_wheel_market_batch(%L::uuid, 2)',
    (select id from test_market_batch_ids where name = 'type_outage_batch')
  ),
  'P0001',
  'Wheel market batch has an incomplete required option type.',
  'batch completion rejects a required option type with zero successes'
);

select ok(
  public.fail_wheel_market_batch(
    (select id from test_market_batch_ids where name = 'type_outage_batch'),
    'call provider unavailable'
  ),
  'a required-type outage marks the replacement batch failed'
);

select throws_ok(
  format(
    'select public.complete_wheel_market_batch(%L::uuid, 2)',
    (select id from test_market_batch_ids where name = 'type_outage_batch')
  ),
  'P0001',
  'A failed wheel market batch cannot be completed.',
  'replaying completion cannot expose a failed required-type outage'
);

select is(
  (
    select snapshot_id
    from public.wheel_market_batch_current_snapshots
    where persona = 'balanced_wheel'
      and strategy = 'short_put'
  ),
  (select id from test_market_batch_ids where name = 'first_snapshot'),
  'a required-type outage retains the previous put pointer'
);

select is(
  (
    select count(*)::integer
    from public.wheel_market_batch_current_snapshots
    where persona = 'balanced_wheel'
      and strategy = 'covered_call'
  ),
  0,
  'a required-type outage creates no call pointer'
);

insert into test_market_batch_ids (name, id)
select
  'newer_batch',
  (public.create_wheel_market_batch(
    '2026-07-27T20:30:00Z:opra',
    '2026-07-27T20:30:00Z'::timestamptz,
    'opra'
  )->>'batch_id')::uuid;

update public.wheel_market_batches
set status = 'facts_ready'
where id = (select id from test_market_batch_ids where name = 'newer_batch');

insert into test_market_batch_ids (name, id)
select
  'newer_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'newer_batch'),
    'balanced_wheel',
    'short_put',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T20:30:00Z'::timestamptz,
    '2026-07-27T20:45:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

select is(
  (
    public.publish_wheel_market_batch_snapshot(
      (select id from test_market_batch_ids where name = 'newer_snapshot'),
      0,
      0,
      0,
      '[]'::jsonb,
      '[]'::jsonb
    )->>'staged'
  )::boolean,
  true,
  'a newer consumer snapshot stages without advancing the pointer'
);

select is(
  public.complete_wheel_market_batch(
    (select id from test_market_batch_ids where name = 'newer_batch'),
    1
  )->>'pointer_count',
  '1',
  'atomic completion advances the newer interval pointer'
);

insert into test_market_batch_ids (name, id)
select
  'late_older_batch',
  (public.create_wheel_market_batch(
    '2026-07-27T19:45:00Z:opra',
    '2026-07-27T19:45:00Z'::timestamptz,
    'opra'
  )->>'batch_id')::uuid;

update public.wheel_market_batches
set status = 'facts_ready'
where id = (
  select id
  from test_market_batch_ids
  where name = 'late_older_batch'
);

insert into test_market_batch_ids (name, id)
select
  'late_older_snapshot',
  (public.create_wheel_market_batch_snapshot(
    (select id from test_market_batch_ids where name = 'late_older_batch'),
    'balanced_wheel',
    'short_put',
    '{"dteMax":30,"dteMin":21}',
    '{"dteMax":30,"dteMin":21}'::jsonb,
    'opra',
    50,
    '2026-07-27T19:45:00Z'::timestamptz,
    '2026-07-27T20:00:00Z'::timestamptz
  )->>'snapshot_id')::uuid;

select is(
  (
    public.publish_wheel_market_batch_snapshot(
      (select id from test_market_batch_ids where name = 'late_older_snapshot'),
      0,
      0,
      0,
      '[]'::jsonb,
      '[]'::jsonb
    )->>'staged'
  )::boolean,
  true,
  'a late older consumer snapshot stages successfully'
);

select is(
  public.complete_wheel_market_batch(
    (select id from test_market_batch_ids where name = 'late_older_batch'),
    1
  )->>'pointer_count',
  '0',
  'late older batch completion does not replace a newer interval'
);

select is(
  (
    select snapshot_id
    from public.wheel_market_batch_current_snapshots
    where persona = 'balanced_wheel'
      and strategy = 'short_put'
  ),
  (select id from test_market_batch_ids where name = 'newer_snapshot'),
  'the current pointer rejects a stale late-publishing interval'
);

select * from finish();
rollback;
