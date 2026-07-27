begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select no_plan();

with lifecycle_tables(table_name) as (
  values
    ('account_deletion_requests'),
    ('account_data_retention_runs')
)
select ok(
  c.relrowsecurity and c.relforcerowsecurity,
  format('RLS is enabled and forced on public.%I', lifecycle_tables.table_name)
)
from lifecycle_tables
join pg_class c
  on c.relname = lifecycle_tables.table_name
join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by lifecycle_tables.table_name;

with
lifecycle_tables(table_name) as (
  values
    ('account_deletion_requests'),
    ('account_data_retention_runs')
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
  format('%s lacks %s on public.%I', role_name, operation, table_name)
)
from lifecycle_tables
cross join untrusted_roles
cross join operations
order by table_name, role_name, operation;

with
lifecycle_tables(table_name) as (
  values
    ('account_deletion_requests'),
    ('account_data_retention_runs')
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
  format('service_role has %s on public.%I', operation, table_name)
)
from lifecycle_tables
cross join operations
order by table_name, operation;

select ok(
  not exists (
    select 1
    from pg_policy policy
    join pg_class table_class on table_class.oid = policy.polrelid
    join pg_namespace schema on schema.oid = table_class.relnamespace
    where schema.nspname = 'public'
      and table_class.relname = any(array[
        'account_deletion_requests',
        'account_data_retention_runs'
      ])
  ),
  'service-only lifecycle tables expose no user policy'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.export_account_data()',
    'EXECUTE'
  ),
  'authenticated can execute its own account export'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.export_account_data()',
    'EXECUTE'
  ),
  'anon cannot execute account export'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.export_account_data()',
    'EXECUTE'
  ),
  'service_role cannot bypass user-derived account export'
);

with service_functions(signature) as (
  values
    ('public.delete_account_application_data(uuid)'::regprocedure),
    ('public.run_account_data_retention()'::regprocedure)
)
select ok(
  has_function_privilege('service_role', signature, 'EXECUTE'),
  format('service_role can execute %s', signature)
)
from service_functions
order by signature::text;

with
service_functions(signature) as (
  values
    ('public.delete_account_application_data(uuid)'::regprocedure),
    ('public.run_account_data_retention()'::regprocedure)
),
untrusted_roles(role_name) as (
  values ('anon'), ('authenticated')
)
select ok(
  not has_function_privilege(role_name, signature, 'EXECUTE'),
  format('%s cannot execute %s', role_name, signature)
)
from service_functions
cross join untrusted_roles
order by signature::text, role_name;

with lifecycle_functions(signature) as (
  values
    ('public.export_account_data()'::regprocedure),
    ('public.delete_account_application_data(uuid)'::regprocedure),
    ('public.run_account_data_retention()'::regprocedure)
)
select ok(
  not procedure.prosecdef,
  format('%s is SECURITY INVOKER', signature)
)
from lifecycle_functions
join pg_proc procedure on procedure.oid = signature
order by signature::text;

with lifecycle_functions(signature) as (
  values
    ('public.export_account_data()'::regprocedure),
    ('public.delete_account_application_data(uuid)'::regprocedure),
    ('public.run_account_data_retention()'::regprocedure)
)
select is(
  procedure.proconfig,
  array['search_path=""'],
  format('%s has an empty fixed search_path', signature)
)
from lifecycle_functions
join pg_proc procedure on procedure.oid = signature
order by signature::text;

select is(
  (
    select count(*)::integer
    from cron.job
    where jobname = 'alpha-dog-account-data-retention'
      and schedule = '15 3 * * *'
      and command = 'select public.run_account_data_retention();'
      and active
  ),
  1,
  'one active daily account-data retention job is scheduled'
);

insert into public.account_deletion_requests (
  id,
  user_id,
  user_fingerprint,
  token_hash,
  confirmation_email_hash,
  status,
  reauthenticated_at,
  expires_at,
  completed_at
)
values (
  '7d3db532-4dd5-49bc-864c-8ad780781014',
  null,
  'retention-failure-user-fingerprint',
  null,
  'retention-failure-email-hash',
  'completed',
  now() - interval '101 days',
  now() - interval '100 days',
  now() - interval '100 days'
);

create function pg_temp.fail_account_deletion_retention()
returns trigger
language plpgsql
as $$
begin
  if old.id = '7d3db532-4dd5-49bc-864c-8ad780781014'::uuid then
    raise exception 'forced retention failure';
  end if;

  return old;
end;
$$;

create trigger account_deletion_retention_failure_test
  before delete on public.account_deletion_requests
  for each row
  execute function pg_temp.fail_account_deletion_retention();

create temporary table account_retention_failure_result
on commit drop
as
select public.run_account_data_retention() as result;

select is(
  (select result ->> 'status' from account_retention_failure_result),
  'failed',
  'retention reports a failed destructive subtransaction'
);
select is(
  (select result ->> 'errorCode' from account_retention_failure_result),
  'P0001',
  'retention exposes only the bounded SQLSTATE failure code'
);
select is(
  (
    select count(*)::integer
    from public.account_deletion_requests
    where id = '7d3db532-4dd5-49bc-864c-8ad780781014'
  ),
  1,
  'failed retention rolls back the candidate deletion'
);
select is(
  (
    select status
    from public.account_data_retention_runs
    where id = (
      select (result ->> 'runId')::uuid
      from account_retention_failure_result
    )
  ),
  'failed',
  'failed retention preserves an observable run record'
);
select is(
  (
    select error_code
    from public.account_data_retention_runs
    where id = (
      select (result ->> 'runId')::uuid
      from account_retention_failure_result
    )
  ),
  'P0001',
  'failed retention persists only the SQLSTATE error code'
);

select * from finish();
rollback;
