with observability_relations as (
  select c.oid, n.nspname, c.relname
  from pg_catalog.pg_class as c
  join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname like 'observability\_%' escape '\'
),
objects as (
  select
    'relation:' || r.nspname || '.' || r.relname as object_key,
    pg_catalog.concat_ws(
      '|',
      c.relkind,
      c.relrowsecurity,
      c.relforcerowsecurity,
      coalesce(c.relacl::text, '')
    ) as definition
  from observability_relations as r
  join pg_catalog.pg_class as c on c.oid = r.oid

  union all

  select
    'column:' || r.nspname || '.' || r.relname || '.' || a.attnum,
    pg_catalog.concat_ws(
      '|',
      a.attname,
      pg_catalog.format_type(a.atttypid, a.atttypmod),
      a.attnotnull,
      a.attidentity,
      a.attgenerated,
      coalesce(pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')
    )
  from observability_relations as r
  join pg_catalog.pg_attribute as a
    on a.attrelid = r.oid
    and a.attnum > 0
    and not a.attisdropped
  left join pg_catalog.pg_attrdef as d
    on d.adrelid = a.attrelid
    and d.adnum = a.attnum

  union all

  select
    'constraint:' || r.nspname || '.' || r.relname || '.' || c.conname,
    pg_catalog.pg_get_constraintdef(c.oid, true)
  from observability_relations as r
  join pg_catalog.pg_constraint as c on c.conrelid = r.oid

  union all

  select
    'index:' || r.nspname || '.' || r.relname || '.' || ic.relname,
    pg_catalog.pg_get_indexdef(i.indexrelid)
  from observability_relations as r
  join pg_catalog.pg_index as i on i.indrelid = r.oid
  join pg_catalog.pg_class as ic on ic.oid = i.indexrelid

  union all

  select
    'trigger:' || r.nspname || '.' || r.relname || '.' || t.tgname,
    pg_catalog.pg_get_triggerdef(t.oid, true)
  from observability_relations as r
  join pg_catalog.pg_trigger as t
    on t.tgrelid = r.oid
    and not t.tgisinternal

  union all

  select
    'policy:' || r.nspname || '.' || r.relname || '.' || p.polname,
    pg_catalog.concat_ws(
      '|',
      p.polcmd,
      p.polpermissive,
      p.polroles::text,
      coalesce(pg_catalog.pg_get_expr(p.polqual, p.polrelid), ''),
      coalesce(pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid), '')
    )
  from observability_relations as r
  join pg_catalog.pg_policy as p on p.polrelid = r.oid

  union all

  select
    'function:' || p.oid::regprocedure::text,
    pg_catalog.concat_ws(
      '|',
      pg_catalog.pg_get_functiondef(p.oid),
      p.prosecdef,
      p.proconfig::text,
      coalesce(p.proacl::text, '')
    )
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like '%observability%'

  union all

  select
    'cron:' || j.jobname,
    pg_catalog.concat_ws(
      '|',
      j.schedule,
      j.command,
      j.database,
      j.username,
      j.active
    )
  from cron.job as j
  where j.jobname = 'alpha-dog-observability-alert-evaluator'
)
select
  count(*) as object_count,
  pg_catalog.encode(
    extensions.digest(
      pg_catalog.string_agg(
        object_key || '=' || definition,
        E'\n'
        order by object_key
      ),
      'sha256'
    ),
    'hex'
  ) as schema_fingerprint
from objects;
