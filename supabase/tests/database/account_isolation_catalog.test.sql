begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(262);

select ok(
  has_schema_privilege('anon', 'public', 'USAGE'),
  'anon has explicit USAGE on the Data API schema'
);
select ok(
  has_schema_privilege('authenticated', 'public', 'USAGE'),
  'authenticated has explicit USAGE on the Data API schema'
);
select ok(
  has_schema_privilege('service_role', 'public', 'USAGE'),
  'service_role has explicit USAGE on the Data API schema'
);

with account_tables(table_name) as (
  values
    ('account_profiles'),
    ('account_identities'),
    ('saved_presets'),
    ('analysis_requests'),
    ('paper_accounts'),
    ('simulated_positions'),
    ('simulated_position_legs'),
    ('simulated_position_events'),
    ('simulated_equity_lots'),
    ('statement_imports'),
    ('statement_import_rows'),
    ('statement_reconciliation_groups'),
    ('statement_reconciliation_group_rows'),
    ('statement_import_review_audit')
)
select ok(
  c.relrowsecurity,
  format('RLS is enabled on public.%I', account_tables.table_name)
)
from account_tables
join pg_class c
  on c.relname = account_tables.table_name
join pg_namespace n
  on n.oid = c.relnamespace
 and n.nspname = 'public'
order by account_tables.table_name;

with
account_tables(table_name, authenticated_update, authenticated_delete) as (
  values
    ('account_profiles', true, true),
    ('account_identities', true, true),
    ('saved_presets', true, true),
    ('analysis_requests', true, true),
    ('paper_accounts', true, true),
    ('simulated_positions', true, true),
    ('simulated_position_legs', true, true),
    ('simulated_position_events', true, true),
    ('simulated_equity_lots', true, true),
    ('statement_imports', true, true),
    ('statement_import_rows', true, true),
    ('statement_reconciliation_groups', true, true),
    ('statement_reconciliation_group_rows', true, true),
    ('statement_import_review_audit', false, false)
),
operations(operation) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
),
expectations as (
  select
    table_name,
    operation,
    case operation
      when 'UPDATE' then authenticated_update
      when 'DELETE' then authenticated_delete
      else true
    end as authenticated_expected
  from account_tables
  cross join operations
)
select ok(
  not has_table_privilege(
    'anon',
    format('public.%I', table_name),
    operation
  ),
  format('anon lacks %s on public.%I', operation, table_name)
)
from expectations
order by table_name, operation;

with
account_tables(table_name, authenticated_update, authenticated_delete) as (
  values
    ('account_profiles', true, true),
    ('account_identities', true, true),
    ('saved_presets', true, true),
    ('analysis_requests', true, true),
    ('paper_accounts', true, true),
    ('simulated_positions', true, true),
    ('simulated_position_legs', true, true),
    ('simulated_position_events', true, true),
    ('simulated_equity_lots', true, true),
    ('statement_imports', true, true),
    ('statement_import_rows', true, true),
    ('statement_reconciliation_groups', true, true),
    ('statement_reconciliation_group_rows', true, true),
    ('statement_import_review_audit', false, false)
),
operations(operation) as (
  values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
),
expectations as (
  select
    table_name,
    operation,
    case operation
      when 'UPDATE' then authenticated_update
      when 'DELETE' then authenticated_delete
      else true
    end as authenticated_expected
  from account_tables
  cross join operations
)
select is(
  has_table_privilege(
    'authenticated',
    format('public.%I', table_name),
    operation
  ),
  authenticated_expected,
  format(
    'authenticated %s privilege on public.%I matches the operation contract',
    operation,
    table_name
  )
)
from expectations
order by table_name, operation;

with account_tables(table_name) as (
  values
    ('account_profiles'),
    ('account_identities'),
    ('saved_presets'),
    ('analysis_requests'),
    ('paper_accounts'),
    ('simulated_positions'),
    ('simulated_position_legs'),
    ('simulated_position_events'),
    ('simulated_equity_lots'),
    ('statement_imports'),
    ('statement_import_rows'),
    ('statement_reconciliation_groups'),
    ('statement_reconciliation_group_rows'),
    ('statement_import_review_audit')
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
from account_tables
cross join operations
order by table_name, operation;

with account_tables(table_name) as (
  values
    ('account_profiles'),
    ('account_identities'),
    ('saved_presets'),
    ('analysis_requests'),
    ('paper_accounts'),
    ('simulated_positions'),
    ('simulated_position_legs'),
    ('simulated_position_events'),
    ('simulated_equity_lots'),
    ('statement_imports'),
    ('statement_import_rows'),
    ('statement_reconciliation_groups'),
    ('statement_reconciliation_group_rows'),
    ('statement_import_review_audit')
),
roles(role_name) as (
  values ('anon'), ('authenticated'), ('service_role')
)
select ok(
  not (
    has_table_privilege(
      role_name,
      format('public.%I', table_name),
      'TRUNCATE'
    ) or
    has_table_privilege(
      role_name,
      format('public.%I', table_name),
      'REFERENCES'
    ) or
    has_table_privilege(
      role_name,
      format('public.%I', table_name),
      'TRIGGER'
    )
  ),
  format(
    '%s lacks non-Data-API privileges on public.%I',
    role_name,
    table_name
  )
)
from account_tables
cross join roles
order by table_name, role_name;

select ok(
  not exists (
    select 1
    from information_schema.table_privileges
    where table_schema = 'public'
      and table_name = any(array[
        'account_profiles',
        'account_identities',
        'saved_presets',
        'analysis_requests',
        'paper_accounts',
        'simulated_positions',
        'simulated_position_legs',
        'simulated_position_events',
        'simulated_equity_lots',
        'statement_imports',
        'statement_import_rows',
        'statement_reconciliation_groups',
        'statement_reconciliation_group_rows',
        'statement_import_review_audit'
      ])
      and grantee = 'PUBLIC'
  ),
  'PUBLIC has no privilege on account-owned tables'
);

select is(
  (
    select count(*)::integer
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'account_profiles',
        'account_identities',
        'saved_presets',
        'analysis_requests',
        'paper_accounts',
        'simulated_positions',
        'simulated_position_legs',
        'simulated_position_events',
        'simulated_equity_lots',
        'statement_imports',
        'statement_import_rows',
        'statement_reconciliation_groups',
        'statement_reconciliation_group_rows',
        'statement_import_review_audit'
      ])
  ),
  54,
  'account-owned tables expose the complete 54-policy operation matrix'
);

select ok(
  not exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'account_profiles',
        'account_identities',
        'saved_presets',
        'analysis_requests',
        'paper_accounts',
        'simulated_positions',
        'simulated_position_legs',
        'simulated_position_events',
        'simulated_equity_lots',
        'statement_imports',
        'statement_import_rows',
        'statement_reconciliation_groups',
        'statement_reconciliation_group_rows',
        'statement_import_review_audit'
      ])
      and p.polroles <> array['authenticated'::regrole::oid]
  ),
  'every account policy targets only authenticated'
);

select ok(
  not exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'account_profiles',
        'account_identities',
        'saved_presets',
        'analysis_requests',
        'paper_accounts',
        'simulated_positions',
        'simulated_position_legs',
        'simulated_position_events',
        'simulated_equity_lots',
        'statement_imports',
        'statement_import_rows',
        'statement_reconciliation_groups',
        'statement_reconciliation_group_rows',
        'statement_import_review_audit'
      ])
      and p.polcmd in ('r', 'd')
      and (
        p.polqual is null or
        pg_get_expr(p.polqual, p.polrelid, true) !~ 'SELECT auth\.uid\(\)'
      )
  ),
  'SELECT and DELETE policies use owner USING checks with select auth.uid()'
);

select ok(
  not exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'account_profiles',
        'account_identities',
        'saved_presets',
        'analysis_requests',
        'paper_accounts',
        'simulated_positions',
        'simulated_position_legs',
        'simulated_position_events',
        'simulated_equity_lots',
        'statement_imports',
        'statement_import_rows',
        'statement_reconciliation_groups',
        'statement_reconciliation_group_rows',
        'statement_import_review_audit'
      ])
      and p.polcmd = 'a'
      and (
        p.polwithcheck is null or
        pg_get_expr(p.polwithcheck, p.polrelid, true) !~
          'SELECT auth\.uid\(\)'
      )
  ),
  'INSERT policies use owner WITH CHECK checks with select auth.uid()'
);

select ok(
  not exists (
    select 1
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'account_profiles',
        'account_identities',
        'saved_presets',
        'analysis_requests',
        'paper_accounts',
        'simulated_positions',
        'simulated_position_legs',
        'simulated_position_events',
        'simulated_equity_lots',
        'statement_imports',
        'statement_import_rows',
        'statement_reconciliation_groups',
        'statement_reconciliation_group_rows'
      ])
      and p.polcmd = 'w'
      and (
        p.polqual is null or
        p.polwithcheck is null or
        pg_get_expr(p.polqual, p.polrelid, true) !~
          'SELECT auth\.uid\(\)' or
        pg_get_expr(p.polwithcheck, p.polrelid, true) !~
          'SELECT auth\.uid\(\)'
      )
  ),
  'UPDATE policies use owner USING and WITH CHECK checks'
);

with lifecycle_functions(function_oid, signature) as (
  values
    (
      'public.open_simulated_position_atomic(jsonb)'::regprocedure,
      'open_simulated_position_atomic(jsonb)'
    ),
    (
      'public.close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'::regprocedure,
      'close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'
    ),
    (
      'public.expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'::regprocedure,
      'expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'
    ),
    (
      'public.finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
      'finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'
    )
)
select ok(
  not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.oid = lifecycle_functions.function_oid
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  format('PUBLIC lacks EXECUTE on %s', signature)
)
from lifecycle_functions
order by signature;

with lifecycle_functions(function_oid, signature) as (
  values
    (
      'public.open_simulated_position_atomic(jsonb)'::regprocedure,
      'open_simulated_position_atomic(jsonb)'
    ),
    (
      'public.close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'::regprocedure,
      'close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'
    ),
    (
      'public.expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'::regprocedure,
      'expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'
    ),
    (
      'public.finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
      'finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'
    )
)
select ok(
  not has_function_privilege('anon', function_oid, 'EXECUTE'),
  format('anon lacks EXECUTE on %s', signature)
)
from lifecycle_functions
order by signature;

with lifecycle_functions(function_oid, signature) as (
  values
    (
      'public.open_simulated_position_atomic(jsonb)'::regprocedure,
      'open_simulated_position_atomic(jsonb)'
    ),
    (
      'public.close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'::regprocedure,
      'close_simulated_position_atomic(uuid,numeric,timestamptz,text)'
    ),
    (
      'public.expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'::regprocedure,
      'expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'
    ),
    (
      'public.finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
      'finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'
    )
)
select ok(
  has_function_privilege('authenticated', function_oid, 'EXECUTE'),
  format('authenticated has EXECUTE on %s', signature)
)
from lifecycle_functions
order by signature;

with lifecycle_functions(function_oid, signature) as (
  values
    (
      'public.open_simulated_position_atomic(jsonb)'::regprocedure,
      'open_simulated_position_atomic(jsonb)'
    ),
    (
      'public.close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'::regprocedure,
      'close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'
    ),
    (
      'public.expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'::regprocedure,
      'expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'
    ),
    (
      'public.finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
      'finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'
    )
)
select ok(
  not has_function_privilege('service_role', function_oid, 'EXECUTE'),
  format('service_role lacks user-lifecycle EXECUTE on %s', signature)
)
from lifecycle_functions
order by signature;

with lifecycle_functions(function_oid, signature) as (
  values
    (
      'public.open_simulated_position_atomic(jsonb)'::regprocedure,
      'open_simulated_position_atomic(jsonb)'
    ),
    (
      'public.close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'::regprocedure,
      'close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'
    ),
    (
      'public.expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'::regprocedure,
      'expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'
    ),
    (
      'public.finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
      'finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'
    )
)
select ok(
  not p.prosecdef,
  format('%s is SECURITY INVOKER', signature)
)
from lifecycle_functions
join pg_proc p on p.oid = lifecycle_functions.function_oid
order by signature;

with lifecycle_functions(function_oid, signature) as (
  values
    (
      'public.open_simulated_position_atomic(jsonb)'::regprocedure,
      'open_simulated_position_atomic(jsonb)'
    ),
    (
      'public.close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'::regprocedure,
      'close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)'
    ),
    (
      'public.expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'::regprocedure,
      'expire_simulated_position_atomic(uuid,numeric,timestamptz,text)'
    ),
    (
      'public.finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'::regprocedure,
      'finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)'
    )
)
select is(
  p.proconfig,
  array['search_path=""'],
  format('%s has an empty fixed search_path', signature)
)
from lifecycle_functions
join pg_proc p on p.oid = lifecycle_functions.function_oid
order by signature;

select ok(
  not exists (
    select 1
    from pg_constraint c
    where c.contype = 'f'
      and c.connamespace = 'public'::regnamespace
      and c.conrelid::regclass::text = any(array[
        'account_profiles',
        'account_identities',
        'saved_presets',
        'analysis_requests',
        'paper_accounts',
        'simulated_positions',
        'simulated_position_legs',
        'simulated_position_events',
        'simulated_equity_lots',
        'statement_imports',
        'statement_import_rows',
        'statement_reconciliation_groups',
        'statement_reconciliation_group_rows',
        'statement_import_review_audit'
      ])
      and not exists (
        select 1
        from pg_index i
        where i.indrelid = c.conrelid
          and i.indisvalid
          and i.indisready
          and (i.indkey::smallint[])[0:cardinality(c.conkey) - 1] =
            c.conkey
      )
  ),
  'every account ownership foreign key has a covering index'
);

select has_index(
  'public',
  'simulated_position_events',
  'simulated_position_events_paper_account_idx',
  'simulated_position_events paper-account ownership lookup is indexed'
);
select has_index(
  'public',
  'statement_import_review_audit',
  'statement_import_review_audit_group_idx',
  'statement review group ownership lookup is indexed'
);
select has_index(
  'public',
  'statement_import_review_audit',
  'statement_import_review_audit_user_idx',
  'statement review user ownership lookup is indexed'
);

select is(
  (
    select count(*)::integer
    from pg_class sequence
    join pg_namespace n on n.oid = sequence.relnamespace
    where n.nspname = 'public'
      and sequence.relkind = 'S'
      and sequence.relname ~
        '^(account_|saved_|analysis_|paper_|simulated_|statement_)'
  ),
  0,
  'account-owned UUID tables introduce no sequence privileges to grant'
);

select * from finish();
rollback;
