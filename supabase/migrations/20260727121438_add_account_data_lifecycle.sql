create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  user_fingerprint text not null,
  token_hash text unique,
  confirmation_email_hash text not null,
  status text not null default 'authorized',
  attempt_count integer not null default 0,
  reauthenticated_at timestamptz not null,
  expires_at timestamptz not null,
  sessions_revoked_at timestamptz,
  application_data_deleted_at timestamptz,
  auth_user_deleted_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletion_requests_status_valid check (
    status in (
      'authorized',
      'sessions_revoked',
      'application_data_deleted',
      'auth_user_deleted',
      'completed',
      'failed'
    )
  ),
  constraint account_deletion_requests_attempt_count_non_negative check (
    attempt_count >= 0
  ),
  constraint account_deletion_requests_user_fingerprint_not_blank check (
    btrim(user_fingerprint) <> ''
  ),
  constraint account_deletion_requests_email_hash_not_blank check (
    btrim(confirmation_email_hash) <> ''
  ),
  constraint account_deletion_requests_token_hash_not_blank check (
    token_hash is null or btrim(token_hash) <> ''
  ),
  constraint account_deletion_requests_expiry_valid check (
    expires_at > reauthenticated_at
  ),
  constraint account_deletion_requests_completed_pseudonymous check (
    status <> 'completed' or (
      user_id is null and
      token_hash is null and
      completed_at is not null
    )
  )
);

create index if not exists account_deletion_requests_user_status_idx
  on public.account_deletion_requests (user_id, status, created_at desc)
  where user_id is not null;

create index if not exists account_deletion_requests_expiry_idx
  on public.account_deletion_requests (expires_at)
  where status <> 'completed';

create index if not exists account_deletion_requests_completed_idx
  on public.account_deletion_requests (completed_at)
  where completed_at is not null;

drop trigger if exists account_deletion_requests_set_updated_at
  on public.account_deletion_requests;

create trigger account_deletion_requests_set_updated_at
  before update on public.account_deletion_requests
  for each row
  execute function public.set_updated_at();

alter table public.account_deletion_requests enable row level security;
alter table public.account_deletion_requests force row level security;

revoke all on table public.account_deletion_requests
  from public, anon, authenticated;
grant select, insert, update, delete on table public.account_deletion_requests
  to service_role;

create table if not exists public.account_data_retention_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_counts jsonb not null default '{}'::jsonb,
  error_code text,
  constraint account_data_retention_runs_status_valid check (
    status in ('running', 'completed', 'failed')
  ),
  constraint account_data_retention_runs_completion_valid check (
    (status = 'running' and completed_at is null) or
    (status <> 'running' and completed_at is not null)
  )
);

create index if not exists account_data_retention_runs_started_idx
  on public.account_data_retention_runs (started_at desc);

alter table public.account_data_retention_runs enable row level security;
alter table public.account_data_retention_runs force row level security;

revoke all on table public.account_data_retention_runs
  from public, anon, authenticated;
grant select, insert, update, delete on table public.account_data_retention_runs
  to service_role;

create index if not exists statement_imports_incomplete_retention_idx
  on public.statement_imports (updated_at, id)
  where status in ('uploaded', 'parsed', 'needs_review', 'failed');

create index if not exists statement_imports_imported_retention_idx
  on public.statement_imports (
    coalesce(imported_at, updated_at),
    id
  )
  where status = 'imported';

create index if not exists analysis_requests_retention_idx
  on public.analysis_requests (requested_at, id);

create or replace function public.export_account_data()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise exception 'Authentication is required.'
      using errcode = '42501';
  end if;

  return jsonb_build_object(
    'profile',
    (
      select to_jsonb(profile)
      from public.account_profiles as profile
      where profile.id = v_user_id
    ),
    'identities',
    coalesce(
      (
        select jsonb_agg(to_jsonb(identity) order by identity.created_at, identity.id)
        from public.account_identities as identity
        where identity.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'presets',
    coalesce(
      (
        select jsonb_agg(to_jsonb(preset) order by preset.created_at, preset.id)
        from public.saved_presets as preset
        where preset.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'analysisRequests',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(analysis_request)
          order by analysis_request.requested_at, analysis_request.id
        )
        from public.analysis_requests as analysis_request
        where analysis_request.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'paperAccounts',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(paper_account)
          order by paper_account.created_at, paper_account.id
        )
        from public.paper_accounts as paper_account
        where paper_account.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'positions',
    coalesce(
      (
        select jsonb_agg(to_jsonb(position) order by position.opened_at, position.id)
        from public.simulated_positions as position
        where position.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'positionLegs',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(leg)
          order by leg.position_id, leg.leg_index, leg.id
        )
        from public.simulated_position_legs as leg
        where exists (
          select 1
          from public.simulated_positions as owner_position
          where owner_position.id = leg.position_id
            and owner_position.user_id = v_user_id
        )
      ),
      '[]'::jsonb
    ),
    'positionEvents',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(position_event)
          order by position_event.created_at, position_event.id
        )
        from public.simulated_position_events as position_event
        where position_event.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'equityLots',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(equity_lot)
          order by equity_lot.acquired_at, equity_lot.id
        )
        from public.simulated_equity_lots as equity_lot
        where equity_lot.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'statementImports',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(statement_import)
          order by statement_import.created_at, statement_import.id
        )
        from public.statement_imports as statement_import
        where statement_import.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'statementImportRows',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(statement_row)
          order by statement_row.import_id, statement_row.row_index, statement_row.id
        )
        from public.statement_import_rows as statement_row
        where statement_row.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'reconciliationGroups',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(reconciliation_group)
          order by reconciliation_group.created_at, reconciliation_group.id
        )
        from public.statement_reconciliation_groups as reconciliation_group
        where reconciliation_group.user_id = v_user_id
      ),
      '[]'::jsonb
    ),
    'reconciliationGroupRows',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(group_row)
          order by group_row.created_at, group_row.group_id, group_row.row_id
        )
        from public.statement_reconciliation_group_rows as group_row
        where exists (
          select 1
          from public.statement_reconciliation_groups as owner_group
          where owner_group.id = group_row.group_id
            and owner_group.user_id = v_user_id
        )
      ),
      '[]'::jsonb
    ),
    'reviewAudit',
    coalesce(
      (
        select jsonb_agg(
          to_jsonb(review_audit)
          order by review_audit.created_at, review_audit.id
        )
        from public.statement_import_review_audit as review_audit
        where review_audit.user_id = v_user_id
      ),
      '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.export_account_data()
  from public, anon, service_role;
grant execute on function public.export_account_data()
  to authenticated;

create or replace function public.delete_account_application_data(
  p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_identity_count integer := 0;
  v_profile_count integer := 0;
begin
  if p_user_id is null then
    raise exception 'A user identifier is required.'
      using errcode = '22023';
  end if;

  delete from public.account_identities
  where account_identities.user_id = p_user_id;
  get diagnostics v_identity_count = row_count;

  delete from public.account_profiles
  where account_profiles.id = p_user_id;
  get diagnostics v_profile_count = row_count;

  return jsonb_build_object(
    'identitiesDeleted',
    v_identity_count,
    'profilesDeleted',
    v_profile_count
  );
end;
$$;

revoke all on function public.delete_account_application_data(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_account_application_data(uuid)
  to service_role;

create or replace function public.run_account_data_retention()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_incomplete_imports integer := 0;
  v_raw_import_rows integer := 0;
  v_completed_imports integer := 0;
  v_analysis_requests integer := 0;
  v_deletion_requests integer := 0;
  v_retention_runs integer := 0;
  v_counts jsonb;
begin
  insert into public.account_data_retention_runs (status)
  values ('running')
  returning id into v_run_id;

  begin
    delete from public.statement_imports
    where statement_imports.status in (
      'uploaded',
      'parsed',
      'needs_review',
      'failed'
    )
      and statement_imports.updated_at < now() - interval '30 days';
    get diagnostics v_incomplete_imports = row_count;

    delete from public.statement_import_rows as statement_row
    using public.statement_imports as statement_import
    where statement_row.import_id = statement_import.id
      and statement_import.status = 'imported'
      and coalesce(
        statement_import.imported_at,
        statement_import.updated_at
      ) < now() - interval '90 days';
    get diagnostics v_raw_import_rows = row_count;

    delete from public.statement_imports
    where statement_imports.status = 'imported'
      and coalesce(
        statement_imports.imported_at,
        statement_imports.updated_at
      ) < now() - interval '365 days';
    get diagnostics v_completed_imports = row_count;

    delete from public.analysis_requests
    where analysis_requests.requested_at < now() - interval '90 days';
    get diagnostics v_analysis_requests = row_count;

    delete from public.account_deletion_requests
    where (
      account_deletion_requests.completed_at is not null
      and account_deletion_requests.completed_at < now() - interval '90 days'
    ) or (
      account_deletion_requests.completed_at is null
      and account_deletion_requests.expires_at < now() - interval '90 days'
    );
    get diagnostics v_deletion_requests = row_count;

    delete from public.account_data_retention_runs
    where account_data_retention_runs.id <> v_run_id
      and account_data_retention_runs.started_at < now() - interval '90 days';
    get diagnostics v_retention_runs = row_count;

    v_counts := jsonb_build_object(
      'incompleteImports',
      v_incomplete_imports,
      'rawImportRows',
      v_raw_import_rows,
      'completedImports',
      v_completed_imports,
      'analysisRequests',
      v_analysis_requests,
      'deletionRequests',
      v_deletion_requests,
      'retentionRuns',
      v_retention_runs
    );

    update public.account_data_retention_runs
    set
      status = 'completed',
      completed_at = now(),
      deleted_counts = v_counts,
      error_code = null
    where id = v_run_id;
  exception
    when others then
      update public.account_data_retention_runs
      set
        status = 'failed',
        completed_at = now(),
        deleted_counts = '{}'::jsonb,
        error_code = sqlstate
      where id = v_run_id;

      return jsonb_build_object(
        'runId',
        v_run_id,
        'status',
        'failed',
        'errorCode',
        sqlstate
      );
  end;

  return jsonb_build_object(
    'runId',
    v_run_id,
    'status',
    'completed',
    'deletedCounts',
    v_counts
  );
end;
$$;

revoke all on function public.run_account_data_retention()
  from public, anon, authenticated;
grant execute on function public.run_account_data_retention()
  to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job_id bigint;
begin
  select jobid
  into v_job_id
  from cron.job
  where jobname = 'alpha-dog-account-data-retention';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'alpha-dog-account-data-retention',
    '15 3 * * *',
    'select public.run_account_data_retention();'
  );
end;
$$;
