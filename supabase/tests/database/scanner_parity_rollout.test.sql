begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

with rollout_tables(table_name) as (
  values
    ('wheel_scanner_rollout_control'),
    ('wheel_scanner_parity_observations')
)
select ok(
  c.relrowsecurity and c.relforcerowsecurity,
  format('public.%I has forced RLS', rollout_tables.table_name)
)
from rollout_tables
join pg_class c
  on c.relname = rollout_tables.table_name
join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by rollout_tables.table_name;

with
rollout_tables(table_name) as (
  values
    ('wheel_scanner_rollout_control'),
    ('wheel_scanner_parity_observations')
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
from rollout_tables
cross join untrusted_roles
cross join operations
order by table_name, role_name, operation;

select is(
  (
    select read_source
    from public.wheel_scanner_rollout_control
    where id
  ),
  'legacy',
  'the public reader defaults to legacy'
);

select is(
  public.set_wheel_scanner_read_source('replacement')->>'read_source',
  'replacement',
  'operations can select replacement without a deployment'
);

select is(
  public.set_wheel_scanner_read_source('legacy')->>'read_source',
  'legacy',
  'operations can immediately roll back to legacy'
);

select throws_ok(
  $$select public.set_wheel_scanner_read_source('invalid')$$,
  '22023',
  'Invalid wheel scanner read source.',
  'invalid read sources fail closed'
);

with functions(signature) as (
  values
    ('public.set_wheel_scanner_read_source(text)'),
    ('public.get_wheel_scanner_parity_metrics(date)')
)
select ok(
  has_function_privilege('service_role', signature, 'EXECUTE'),
  format('service_role can execute %s', signature)
)
from functions
order by signature;

with
functions(signature) as (
  values
    ('public.set_wheel_scanner_read_source(text)'),
    ('public.get_wheel_scanner_parity_metrics(date)')
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

select is(
  (
    select count(*)::integer
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'set_wheel_scanner_read_source',
        'get_wheel_scanner_parity_metrics'
      ])
      and not p.prosecdef
      and p.proconfig = array['search_path=""']
  ),
  2,
  'rollout RPCs are invoker-security with an empty search path'
);

select is(
  (public.get_wheel_scanner_parity_metrics(current_date)->>'observation_count')::integer,
  0,
  'an empty observation window reports zero samples'
);

-- Cohort integrity: batch status and consumer count enforcement
-- Test setup: create batches and observations for each scenario

-- Running batch — excluded
with test_batch(batch_id) as (
  insert into public.wheel_market_batches (
    batch_key, interval_started_at, feed, status, snapshot_count
  )
  values (
    'pg-tap-running-01',
    '2026-01-02 14:00:00+00',
    'opra',
    'running',
    2
  )
  on conflict (batch_key) do nothing
  returning id
)
insert into public.wheel_scanner_parity_observations (
  batch_id, persona, strategy, filter_key, format_version,
  exact_match, market_day,
  candidate_count_legacy, candidate_count_replacement,
  mismatch_count,
  eligibility_mismatch_count, financial_mismatch_count,
  score_mismatch_count, warning_mismatch_count, ordering_mismatch_count
)
select
  test_batch.batch_id,
  'balanced_wheel', 'short_put', 'running-filter', 1,
  true, true,
  2, 2,
  0, 0, 0, 0, 0, 0
from test_batch;

select is(
  (public.get_wheel_scanner_parity_metrics('2026-01-01')::jsonb #>> '{observation_count}')::integer,
  0,
  'running batches are excluded from metrics'
);

-- Failed batch — excluded
with test_batch(batch_id) as (
  insert into public.wheel_market_batches (
    batch_key, interval_started_at, feed, status, snapshot_count
  )
  values (
    'pg-tap-failed-01',
    '2026-01-02 15:00:00+00',
    'opra',
    'failed',
    2
  )
  on conflict (batch_key) do nothing
  returning id
)
insert into public.wheel_scanner_parity_observations (
  batch_id, persona, strategy, filter_key, format_version,
  exact_match, market_day,
  candidate_count_legacy, candidate_count_replacement,
  mismatch_count,
  eligibility_mismatch_count, financial_mismatch_count,
  score_mismatch_count, warning_mismatch_count, ordering_mismatch_count
)
select
  test_batch.batch_id,
  'balanced_wheel', 'short_put', 'failed-filter', 1,
  true, true,
  2, 2,
  0, 0, 0, 0, 0, 0
from test_batch;

select is(
  (public.get_wheel_scanner_parity_metrics('2026-01-01')::jsonb #>> '{observation_count}')::integer,
  0,
  'failed batches are excluded from metrics'
);

-- Complete batch, partial cohort (1 observation, snapshot_count = 2) — excluded
with test_batch(batch_id) as (
  insert into public.wheel_market_batches (
    batch_key, interval_started_at, feed, status, snapshot_count
  )
  values (
    'pg-tap-partial-01',
    '2026-01-02 16:00:00+00',
    'opra',
    'complete',
    2
  )
  on conflict (batch_key) do nothing
  returning id
)
insert into public.wheel_scanner_parity_observations (
  batch_id, persona, strategy, filter_key, format_version,
  exact_match, market_day,
  candidate_count_legacy, candidate_count_replacement,
  mismatch_count,
  eligibility_mismatch_count, financial_mismatch_count,
  score_mismatch_count, warning_mismatch_count, ordering_mismatch_count
)
select
  test_batch.batch_id,
  'balanced_wheel', 'short_put', 'partial-filter', 1,
  true, true,
  2, 2,
  0, 0, 0, 0, 0, 0
from test_batch;

select is(
  (public.get_wheel_scanner_parity_metrics('2026-01-01')::jsonb #>> '{observation_count}')::integer,
  0,
  'partial cohort (1 observation / 2 expected) is excluded from metrics'
);

-- Complete batch, full cohort (2 observations, snapshot_count = 2) — included
with test_batch(batch_id) as (
  insert into public.wheel_market_batches (
    batch_key, interval_started_at, feed, status, snapshot_count
  )
  values (
    'pg-tap-full-01',
    '2026-01-02 17:00:00+00',
    'opra',
    'complete',
    2
  )
  on conflict (batch_key) do nothing
  returning id
)
insert into public.wheel_scanner_parity_observations (
  batch_id, persona, strategy, filter_key, format_version,
  exact_match, market_day,
  candidate_count_legacy, candidate_count_replacement,
  mismatch_count,
  eligibility_mismatch_count, financial_mismatch_count,
  score_mismatch_count, warning_mismatch_count, ordering_mismatch_count
)
select
  test_batch.batch_id,
  consumer.persona, consumer.strategy, format('full-filter-%s', consumer.strategy), 1,
  true, true,
  2, 2,
  0, 0, 0, 0, 0, 0
from test_batch, (
  values
    ('balanced_wheel'::text, 'short_put'::text),
    ('balanced_wheel'::text, 'covered_call'::text)
) as consumer(persona, strategy);

select is(
  (public.get_wheel_scanner_parity_metrics('2026-01-01')::jsonb #>> '{observation_count}')::integer,
  2,
  'full cohort (2 observations / 2 expected) is included in metrics'
);

select is(
  (public.get_wheel_scanner_parity_metrics('2026-01-01')::jsonb #>> '{exact_count}')::integer,
  2,
  'full cohort exact match count is correct'
);

select * from finish();
rollback;
