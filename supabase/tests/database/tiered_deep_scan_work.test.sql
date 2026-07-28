begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

with queue_tables(table_name) as (
  values ('wheel_deep_scan_tiers'), ('wheel_deep_scan_work')
)
select ok(
  catalog.relrowsecurity and catalog.relforcerowsecurity,
  format('public.%I has forced RLS', queue_tables.table_name)
)
from queue_tables
join pg_class as catalog
  on catalog.relname = queue_tables.table_name
join pg_namespace as namespace
  on namespace.oid = catalog.relnamespace
 and namespace.nspname = 'public'
order by queue_tables.table_name;

with legacy_tables(table_name) as (
  values
    ('wheel_underlying_universe'),
    ('wheel_underlying_snapshots'),
    ('wheel_deep_scan_candidates'),
    ('wheel_deep_scan_coverage')
)
select ok(
  catalog.relrowsecurity and catalog.relforcerowsecurity,
  format('public.%I has forced RLS', legacy_tables.table_name)
)
from legacy_tables
join pg_class as catalog
  on catalog.relname = legacy_tables.table_name
join pg_namespace as namespace
  on namespace.oid = catalog.relnamespace
 and namespace.nspname = 'public'
order by legacy_tables.table_name;

with
legacy_tables(table_name) as (
  values
    ('wheel_underlying_universe'),
    ('wheel_underlying_snapshots'),
    ('wheel_deep_scan_candidates'),
    ('wheel_deep_scan_coverage')
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
from legacy_tables
cross join untrusted_roles
cross join operations
order by table_name, role_name, operation;

with
legacy_tables(table_name) as (
  values
    ('wheel_underlying_universe'),
    ('wheel_underlying_snapshots'),
    ('wheel_deep_scan_candidates'),
    ('wheel_deep_scan_coverage')
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
from legacy_tables
cross join operations
order by table_name, operation;

with
queue_tables(table_name) as (
  values ('wheel_deep_scan_tiers'), ('wheel_deep_scan_work')
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
from queue_tables
cross join untrusted_roles
cross join operations
order by table_name, role_name, operation;

with
queue_tables(table_name) as (
  values ('wheel_deep_scan_tiers'), ('wheel_deep_scan_work')
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
from queue_tables
cross join operations
order by table_name, operation;

with functions(signature) as (
  values
    ('public.sync_wheel_deep_scan_work_queue(timestamp with time zone)'),
    ('public.claim_wheel_deep_scan_work(uuid,integer,integer,boolean,timestamp with time zone)'),
    ('public.peek_wheel_deep_scan_work(integer,boolean,timestamp with time zone)'),
    ('public.heartbeat_wheel_deep_scan_work(uuid,jsonb,integer,timestamp with time zone)'),
    ('public.complete_wheel_deep_scan_work_batch(uuid,uuid,jsonb,timestamp with time zone)'),
    ('public.fail_wheel_deep_scan_work_batch(uuid,uuid,jsonb,text,timestamp with time zone)'),
    ('public.get_wheel_deep_scan_work_metrics(timestamp with time zone)')
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
    ('public.sync_wheel_deep_scan_work_queue(timestamp with time zone)'),
    ('public.claim_wheel_deep_scan_work(uuid,integer,integer,boolean,timestamp with time zone)'),
    ('public.peek_wheel_deep_scan_work(integer,boolean,timestamp with time zone)'),
    ('public.heartbeat_wheel_deep_scan_work(uuid,jsonb,integer,timestamp with time zone)'),
    ('public.complete_wheel_deep_scan_work_batch(uuid,uuid,jsonb,timestamp with time zone)'),
    ('public.fail_wheel_deep_scan_work_batch(uuid,uuid,jsonb,text,timestamp with time zone)'),
    ('public.get_wheel_deep_scan_work_metrics(timestamp with time zone)')
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
    from pg_proc as functions
    join pg_namespace as namespace
      on namespace.oid = functions.pronamespace
    where namespace.nspname = 'public'
      and functions.proname = any(array[
        'sync_wheel_deep_scan_work_queue',
        'claim_wheel_deep_scan_work',
        'peek_wheel_deep_scan_work',
        'heartbeat_wheel_deep_scan_work',
        'complete_wheel_deep_scan_work_batch',
        'fail_wheel_deep_scan_work_batch',
        'get_wheel_deep_scan_work_metrics'
      ])
      and not functions.prosecdef
      and functions.proconfig = array['search_path=""']
  ),
  7,
  'all queue RPCs are invoker-security with an empty search path'
);

select is(
  (
    select count(*)::integer
    from public.wheel_deep_scan_tiers
  ),
  3,
  'three default freshness tiers are visible to service operations'
);

select is(
  (
    select freshness_seconds
    from public.wheel_deep_scan_tiers
    where tier = 'priority'
  ),
  900,
  'the priority tier defaults to fifteen-minute freshness'
);

select is(
  (
    select freshness_seconds
    from public.wheel_deep_scan_tiers
    where tier = 'daily'
  ),
  86400,
  'the daily tier defaults to one-day freshness'
);

select is(
  (
    select freshness_seconds
    from public.wheel_deep_scan_tiers
    where tier = 'weekly'
  ),
  604800,
  'the weekly tier defaults to seven-day freshness'
);

insert into public.wheel_underlying_universe (
  symbol,
  company_name,
  exchange,
  optionable,
  active,
  first_seen_at,
  last_seen_at
)
select
  format('Q%04s', series),
  format('Queue Company %s', series),
  case when series % 2 = 0 then 'NASDAQ' else 'NYSE' end,
  true,
  true,
  '2026-07-27T12:00:00Z'::timestamptz,
  '2026-07-27T12:00:00Z'::timestamptz
from generate_series(1, 1005) as series;

insert into public.wheel_underlying_snapshots (
  symbol,
  price,
  daily_volume,
  dollar_volume,
  snapshot,
  captured_at
)
select
  format('Q%04s', series),
  100,
  2000000 - series,
  200000000 - series,
  '{}'::jsonb,
  '2026-07-27T12:00:00Z'::timestamptz
from generate_series(1, 1005) as series;

select lives_ok(
  $$
    select public.sync_wheel_deep_scan_work_queue(
      '2026-07-27T12:00:00Z'::timestamptz
    )
  $$,
  'queue synchronization succeeds'
);

select is(
  (
    select count(*)::integer
    from public.wheel_deep_scan_work
    where coverage_tier = 'priority'
  ),
  500,
  'the highest-ranked 250 symbols create 500 priority option-type units'
);

select is(
  (
    select count(*)::integer
    from public.wheel_deep_scan_work
    where coverage_tier = 'daily'
  ),
  1500,
  'the next 750 symbols create 1500 daily option-type units'
);

select is(
  (
    select count(*)::integer
    from public.wheel_deep_scan_work
    where coverage_tier = 'weekly'
  ),
  10,
  'the remaining five symbols create ten weekly option-type units'
);

update public.wheel_deep_scan_work
set product_priority = 100
where symbol = 'Q1005';

select public.sync_wheel_deep_scan_work_queue(
  '2026-07-27T12:01:00Z'::timestamptz
);

select is(
  (
    select min(coverage_tier)
    from public.wheel_deep_scan_work
    where symbol = 'Q1005'
  ),
  'priority',
  'explicit product priority promotes a low-liquidity symbol'
);

select is(
  (
    select min(tier_rank)
    from public.wheel_deep_scan_work
    where symbol = 'Q1005'
  ),
  1,
  'promoted product priority becomes the first deterministic tier rank'
);

update public.wheel_deep_scan_work
set product_priority = 0
where symbol = 'Q1005';

select public.sync_wheel_deep_scan_work_queue(
  '2026-07-27T12:02:00Z'::timestamptz
);

select is(
  (
    select min(coverage_tier)
    from public.wheel_deep_scan_work
    where symbol = 'Q1005'
  ),
  'weekly',
  'removing explicit priority deterministically demotes the symbol'
);

create temporary table first_claims as
select *
from public.claim_wheel_deep_scan_work(
  '11111111-1111-4111-8111-111111111111'::uuid,
  3,
  3600,
  false,
  '2026-07-27T12:03:00Z'::timestamptz
);

create temporary table second_claims as
select *
from public.claim_wheel_deep_scan_work(
  '22222222-2222-4222-8222-222222222222'::uuid,
  3,
  3600,
  false,
  '2026-07-27T12:03:00Z'::timestamptz
);

select is(
  (select count(*)::integer from first_claims),
  3,
  'the first scheduler receives a bounded claim'
);

select is(
  (select count(*)::integer from second_claims),
  3,
  'the second scheduler receives a bounded claim'
);

select is(
  (
    select count(*)::integer
    from first_claims as first
    join second_claims as second
      using (symbol, option_type)
  ),
  0,
  'separate active schedulers receive disjoint work'
);

select isnt(
  (select min(lease_token::text) from first_claims),
  '',
  'claims receive an opaque ownership token'
);

select lives_ok(
  format(
    $heartbeat$
      select public.heartbeat_wheel_deep_scan_work(
        '11111111-1111-4111-8111-111111111111'::uuid,
        %L::jsonb,
        3600,
        '2026-07-27T12:04:00Z'::timestamptz
      )
    $heartbeat$,
    (
      select jsonb_agg(jsonb_build_object(
        'symbol', symbol,
        'option_type', option_type,
        'lease_token', lease_token
      ))::text
      from first_claims
    )
  ),
  'the current owner can heartbeat an active claim set'
);

create temporary table reclaimed_claim as
select *
from public.claim_wheel_deep_scan_work(
  '33333333-3333-4333-8333-333333333333'::uuid,
  1,
  3600,
  false,
  '2026-07-27T13:05:00Z'::timestamptz
);

select is(
  (select count(*)::integer from reclaimed_claim),
  1,
  'an expired claim is reclaimable'
);

select isnt(
  (select lease_token::text from reclaimed_claim),
  (
    select lease_token::text
    from first_claims
    where (symbol, option_type) = (
      select symbol, option_type from reclaimed_claim
    )
  ),
  'reclaim replaces the stale ownership token'
);

create temporary table test_queue_batches (
  name text primary key,
  id uuid not null
) on commit drop;

insert into test_queue_batches (name, id)
select
  'reclaimed',
  (
    public.create_wheel_market_batch(
      'ad019-reclaimed',
      '2026-07-27T13:00:00Z'::timestamptz,
      'opra'
    )->>'batch_id'
  )::uuid;

select public.checkpoint_wheel_market_batch_underlyings(
  (select id from test_queue_batches where name = 'reclaimed'),
  1,
  1,
  1,
  jsonb_build_object('selectedSymbols', jsonb_build_array(
    (select symbol from reclaimed_claim)
  ))
);

select public.complete_wheel_market_batch_facts(
  (select id from test_queue_batches where name = 'reclaimed'),
  1,
  1,
  1,
  0,
  0,
  '{}'::jsonb
);

select throws_ok(
  format(
    $completion$
      select public.complete_wheel_deep_scan_work_batch(
        %L::uuid,
        '11111111-1111-4111-8111-111111111111'::uuid,
        %L::jsonb,
        '2026-07-27T13:06:00Z'::timestamptz
      )
    $completion$,
    (select id from test_queue_batches where name = 'reclaimed'),
    (
      select jsonb_agg(jsonb_build_object(
        'symbol', reclaimed.symbol,
        'option_type', reclaimed.option_type,
        'lease_token', stale.lease_token,
        'outcome', 'complete',
        'option_contract_count', 1
      ))::text
      from reclaimed_claim as reclaimed
      join first_claims as stale
        using (symbol, option_type)
    )
  ),
  'P0001',
  'Wheel deep-scan completion ownership is stale.',
  'a stale owner cannot complete reclaimed work'
);

create temporary table reclaimed_completion as
select public.complete_wheel_deep_scan_work_batch(
  (select id from test_queue_batches where name = 'reclaimed'),
  '33333333-3333-4333-8333-333333333333'::uuid,
  (
    select jsonb_agg(jsonb_build_object(
      'symbol', symbol,
      'option_type', option_type,
      'lease_token', lease_token,
      'outcome', 'complete',
      'option_contract_count', 5
    ))
    from reclaimed_claim
  ),
  '2026-07-27T13:06:00Z'::timestamptz
) as result;

select is(
  (
    select result ->> 'status'
    from reclaimed_completion
  ),
  'complete',
  'the current owner atomically completes the work batch'
);

select is(
  (
    select status
    from public.wheel_market_batches
    where id = (select id from test_queue_batches where name = 'reclaimed')
  ),
  'complete',
  'coverage completion marks the shared fact batch complete without snapshots'
);

select is(
  (
    select last_outcome
    from public.wheel_deep_scan_work
    where (symbol, option_type) = (
      select symbol, option_type from reclaimed_claim
    )
  ),
  'complete',
  'successful completion publishes a complete freshness outcome'
);

select is(
  (
    select option_contract_count
    from public.wheel_deep_scan_work
    where (symbol, option_type) = (
      select symbol, option_type from reclaimed_claim
    )
  ),
  5,
  'successful completion stores the claimed market-data unit count'
);

select throws_ok(
  format(
    $completion$
      select public.complete_wheel_deep_scan_work_batch(
        %L::uuid,
        '11111111-1111-4111-8111-111111111111'::uuid,
        %L::jsonb,
        '2026-07-27T13:07:00Z'::timestamptz
      )
    $completion$,
    (select id from test_queue_batches where name = 'reclaimed'),
    (
      select jsonb_agg(jsonb_build_object(
        'symbol', reclaimed.symbol,
        'option_type', reclaimed.option_type,
        'lease_token', stale.lease_token,
        'outcome', 'complete',
        'option_contract_count', 1
      ))::text
      from reclaimed_claim as reclaimed
      join first_claims as stale
        using (symbol, option_type)
    )
  ),
  'P0001',
  'Wheel deep-scan completion ownership is stale.',
  'a stale owner cannot complete work after its replacement lease clears'
);

select is(
  (
    public.complete_wheel_deep_scan_work_batch(
      (select id from test_queue_batches where name = 'reclaimed'),
      '33333333-3333-4333-8333-333333333333'::uuid,
      (
        select jsonb_agg(jsonb_build_object(
          'symbol', symbol,
          'option_type', option_type,
          'lease_token', lease_token,
          'outcome', 'complete',
          'option_contract_count', 5
        ))
        from reclaimed_claim
      ),
      '2026-07-27T13:06:00Z'::timestamptz
    )->>'replayed_count'
  )::integer,
  1,
  'completion replay is idempotent'
);

update public.wheel_deep_scan_work
set next_due_at = '2026-07-27T14:00:00Z'::timestamptz
where lease_owner_id is null;

select is(
  (
    select count(*)::integer
    from public.claim_wheel_deep_scan_work(
      '44444444-4444-4444-8444-444444444444'::uuid,
      10,
      3600,
      false,
      '2026-07-27T13:30:00Z'::timestamptz
    )
  ),
  0,
  'an empty due queue returns no claims'
);

select is(
  (
    public.get_wheel_deep_scan_work_metrics(
      '2026-07-27T13:30:00Z'::timestamptz
    )->>'backlog_count'
  )::integer,
  0,
  'backlog metrics query an empty due queue without transferring work rows'
);

select ok(
  (
    public.get_wheel_deep_scan_work_metrics(
      '2026-07-27T13:30:00Z'::timestamptz
    )->'freshness'
  ) ?& array['on_time', 'overdue', 'failed', 'never_scanned'],
  'freshness metrics distinguish all published states'
);

select is(
  jsonb_array_length(
    public.get_wheel_deep_scan_work_metrics(
      '2026-07-27T13:30:00Z'::timestamptz
    )->'tiers'
  ),
  3,
  'per-tier freshness targets and compliance are visible'
);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'wheel_deep_scan_work'
      and indexname = 'wheel_deep_scan_work_due_idx'
      and indexdef ilike '%where (eligible and (lease_owner_id is null))%'
  ),
  'the due queue has a partial index for bounded claims'
);

select * from finish();

rollback;
