begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

with observability_tables(table_name) as (
  values
    ('observability_readiness_state'),
    ('observability_alert_rules'),
    ('observability_alert_samples'),
    ('observability_alert_state'),
    ('observability_alert_events')
)
select ok(
  c.relrowsecurity,
  format('RLS is enabled on public.%I', observability_tables.table_name)
)
from observability_tables
join pg_class c
  on c.relname = observability_tables.table_name
join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by observability_tables.table_name;

with observability_tables(table_name) as (
  values
    ('observability_readiness_state'),
    ('observability_alert_rules'),
    ('observability_alert_samples'),
    ('observability_alert_state'),
    ('observability_alert_events')
)
select ok(
  c.relforcerowsecurity,
  format('RLS is forced on public.%I', observability_tables.table_name)
)
from observability_tables
join pg_class c
  on c.relname = observability_tables.table_name
join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by observability_tables.table_name;

with
observability_tables(table_name) as (
  values
    ('observability_readiness_state'),
    ('observability_alert_rules'),
    ('observability_alert_samples'),
    ('observability_alert_state'),
    ('observability_alert_events')
),
untrusted_roles(role_name) as (
  values ('anon'), ('authenticated')
)
select ok(
  not has_table_privilege(
    role_name,
    format('public.%I', table_name),
    'SELECT'
  ),
  format('%s cannot SELECT public.%I', role_name, table_name)
)
from observability_tables
cross join untrusted_roles
order by table_name, role_name;

with observability_tables(table_name) as (
  values
    ('observability_readiness_state'),
    ('observability_alert_rules'),
    ('observability_alert_samples'),
    ('observability_alert_state'),
    ('observability_alert_events')
)
select ok(
  has_table_privilege(
    'service_role',
    format('public.%I', table_name),
    'SELECT'
  ),
  format('service_role can SELECT public.%I', table_name)
)
from observability_tables
order by table_name;

with expected_table_privileges(table_name, privileges) as (
  values
    (
      'observability_readiness_state',
      array['INSERT', 'SELECT', 'UPDATE']::text[]
    ),
    (
      'observability_alert_rules',
      array['SELECT']::text[]
    ),
    (
      'observability_alert_samples',
      array['DELETE', 'INSERT', 'SELECT']::text[]
    ),
    (
      'observability_alert_state',
      array['INSERT', 'SELECT', 'UPDATE']::text[]
    ),
    (
      'observability_alert_events',
      array['INSERT', 'SELECT']::text[]
    )
)
select is(
  coalesce(
    (
      select array_agg(a.privilege_type order by a.privilege_type)
      from aclexplode(c.relacl) as a
      join pg_roles as grantee on grantee.oid = a.grantee
      where grantee.rolname = 'service_role'
    ),
    array[]::text[]
  ),
  expected_table_privileges.privileges,
  format(
    'service_role has only the intended public.%I privileges',
    expected_table_privileges.table_name
  )
)
from expected_table_privileges
join pg_class c
  on c.relname = expected_table_privileges.table_name
join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by expected_table_privileges.table_name;

with untrusted_roles(role_name) as (
  values ('anon'), ('authenticated')
)
select ok(
  not has_sequence_privilege(
    role_name,
    'public.observability_alert_samples_id_seq',
    'USAGE, SELECT, UPDATE'
  ),
  format(
    '%s has no public.observability_alert_samples_id_seq privilege',
    role_name
  )
)
from untrusted_roles
order by role_name;

select is(
  (
    select array_agg(a.privilege_type order by a.privilege_type)
    from pg_class c
    join pg_namespace n
      on n.oid = c.relnamespace
     and n.nspname = 'public'
    cross join lateral aclexplode(c.relacl) as a
    join pg_roles as grantee on grantee.oid = a.grantee
    where c.relname = 'observability_alert_samples_id_seq'
      and grantee.rolname = 'service_role'
  ),
  array['SELECT', 'USAGE']::text[],
  'service_role has only SELECT and USAGE on the alert sample sequence'
);

with
functions(signature) as (
  values
    ('public.claim_observability_readiness_refresh(uuid,integer)'),
    ('public.complete_observability_readiness_refresh(uuid,text,jsonb,integer)'),
    ('public.evaluate_observability_alerts(timestamp with time zone)'),
    ('public.record_observability_alert_sample(text,numeric,timestamp with time zone)')
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
    ('public.claim_observability_readiness_refresh(uuid,integer)'),
    ('public.complete_observability_readiness_refresh(uuid,text,jsonb,integer)'),
    ('public.evaluate_observability_alerts(timestamp with time zone)'),
    ('public.record_observability_alert_sample(text,numeric,timestamp with time zone)')
)
select ok(
  has_function_privilege('service_role', signature, 'EXECUTE'),
  format('service_role can execute %s', signature)
)
from functions
order by signature;

select is(
  (select count(*)::integer from public.observability_alert_rules),
  6,
  'all six numeric alert rules are active'
);

select is(
  (
    select count(*)::integer
    from cron.job
    where jobname = 'alpha-dog-observability-alert-evaluator'
      and active
      and schedule = '* * * * *'
  ),
  1,
  'the database-native alert evaluator cron is active'
);

select ok(
  public.claim_observability_readiness_refresh(
    '00000000-0000-0000-0000-000000000001'::uuid,
    10
  ),
  'the first readiness refresher claims the shared lease'
);

select ok(
  not public.claim_observability_readiness_refresh(
    '00000000-0000-0000-0000-000000000002'::uuid,
    10
  ),
  'a competing readiness refresher cannot claim the active lease'
);

select ok(
  not public.complete_observability_readiness_refresh(
    '00000000-0000-0000-0000-000000000002'::uuid,
    'ready',
    '{"checks":{"optional":{"healthy":0,"total":0},"required":{"healthy":1,"total":1}},"durationMs":12,"status":"ready"}'::jsonb,
    30
  ),
  'a non-owner cannot publish the readiness aggregate'
);

select ok(
  public.complete_observability_readiness_refresh(
    '00000000-0000-0000-0000-000000000001'::uuid,
    'ready',
    '{"checks":{"optional":{"healthy":0,"total":0},"required":{"healthy":1,"total":1}},"durationMs":12,"status":"ready"}'::jsonb,
    30
  ),
  'the lease owner publishes the readiness aggregate'
);

select is(
  (
    select status
    from public.observability_readiness_state
    where state_key = 'current'
  ),
  'ready',
  'the shared readiness aggregate records ready state'
);

select ok(
  (
    select expires_at > now()
    from public.observability_readiness_state
    where state_key = 'current'
  ),
  'the shared readiness aggregate has a bounded future expiry'
);

delete from public.observability_alert_events;
delete from public.observability_alert_samples;
update public.observability_alert_state
set
  active = false,
  consecutive_healthy_samples = 0,
  last_triggered_at = null,
  last_recovered_at = null,
  updated_at = now();

do $$
declare
  v_evaluated_at timestamptz := pg_catalog.clock_timestamp();
begin
  update public.observability_readiness_state
  set updated_at = v_evaluated_at - interval '16 minutes'
  where state_key = 'current';

  perform *
  from public.evaluate_observability_alerts(v_evaluated_at);
end;
$$;

select is(
  (
    select count(*)::integer
    from public.observability_alert_events
    where alert_key = 'cron_refresh_missing'
      and outcome = 'triggered'
  ),
  1,
  'an absent readiness cron heartbeat creates one durable trigger event'
);

select is(
  (
    select count(*)::integer
    from public.evaluate_observability_alerts(
      pg_catalog.clock_timestamp()
    )
    where alert_key = 'cron_refresh_missing'
  ),
  0,
  'an absent readiness cron heartbeat is deduplicated while active'
);

do $$
declare
  v_recovery_at timestamptz := pg_catalog.clock_timestamp();
begin
  update public.observability_readiness_state
  set updated_at = v_recovery_at
  where state_key = 'current';

  perform *
  from public.evaluate_observability_alerts(v_recovery_at);
end;
$$;

select is(
  (
    select count(*)::integer
    from public.observability_alert_events
    where alert_key = 'cron_refresh_missing'
      and outcome = 'recovered'
  ),
  1,
  'a resumed readiness cron heartbeat creates one recovery event'
);

select is(
  (
    select count(*)::integer
    from public.record_observability_alert_sample(
      'import_finalization_failure',
      1,
      pg_catalog.clock_timestamp()
    )
    where outcome = 'triggered'
  ),
  1,
  'an import finalization failure creates an immediate trigger event'
);

select is(
  (
    select count(*)::integer
    from public.record_observability_alert_sample(
      'import_finalization_failure',
      1,
      pg_catalog.clock_timestamp()
    )
  ),
  0,
  'a duplicate import finalization failure is suppressed while active'
);

select is(
  (
    select count(*)::integer
    from public.record_observability_alert_sample(
      'import_finalization_failure',
      0,
      pg_catalog.clock_timestamp()
    )
    where outcome = 'recovered'
  ),
  1,
  'a successful import finalization creates one recovery event'
);

do $$
declare
  v_index integer;
begin
  for v_index in 1..18 loop
    perform *
    from public.record_observability_alert_sample(
      'provider_error_rate',
      0,
      pg_catalog.clock_timestamp()
    );
  end loop;

  for v_index in 1..2 loop
    perform *
    from public.record_observability_alert_sample(
      'provider_error_rate',
      1,
      pg_catalog.clock_timestamp()
    );
  end loop;
end;
$$;

select is(
  (
    select count(*)::integer
    from public.observability_alert_events
    where alert_key = 'provider_error_rate'
      and outcome = 'triggered'
  ),
  1,
  'the provider error-rate threshold creates one durable trigger event'
);

select is(
  (
    select count(*)::integer
    from public.record_observability_alert_sample(
      'provider_error_rate',
      1,
      pg_catalog.clock_timestamp()
    )
  ),
  0,
  'an active provider alert is deduplicated'
);

do $$
declare
  v_index integer;
  v_recovery_at timestamptz := pg_catalog.clock_timestamp() + interval '6 minutes';
begin
  for v_index in 1..20 loop
    perform *
    from public.record_observability_alert_sample(
      'provider_error_rate',
      0,
      v_recovery_at
    );
  end loop;

  perform * from public.evaluate_observability_alerts(v_recovery_at);
  perform * from public.evaluate_observability_alerts(v_recovery_at);
end;
$$;

select is(
  (
    select count(*)::integer
    from public.observability_alert_events
    where alert_key = 'provider_error_rate'
      and outcome = 'recovered'
  ),
  1,
  'three healthy provider evaluations create one recovery event'
);

select is(
  (
    select count(*)::integer
    from public.record_observability_alert_sample(
      'workflow_failure',
      1,
      pg_catalog.clock_timestamp()
    )
  ),
  1,
  'a workflow failure creates an immediate durable trigger event'
);

select is(
  (
    select count(*)::integer
    from public.record_observability_alert_sample(
      'workflow_failure',
      1,
      pg_catalog.clock_timestamp()
    )
  ),
  0,
  'a duplicate workflow failure is suppressed while active'
);

select is(
  (
    select count(*)::integer
    from public.record_observability_alert_sample(
      'workflow_failure',
      0,
      pg_catalog.clock_timestamp()
    )
  ),
  1,
  'a healthy workflow signal creates one recovery event'
);

select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name in (
        'observability_alert_samples',
        'observability_alert_events'
      )
      and column_name ~ '(email|token|secret|wallet|prompt|body|url|query|row)'
  ),
  'durable alert storage has no sensitive or high-cardinality payload columns'
);

select * from finish();

rollback;
