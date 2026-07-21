alter table public.statement_import_rows
  drop constraint if exists statement_import_rows_status_valid;

alter table public.statement_import_rows
  add constraint statement_import_rows_status_valid check (
    status in (
      'staged',
      'duplicate',
      'ignored',
      'needs_review',
      'rejected',
      'imported',
      'failed'
    )
  );

alter table public.statement_import_rows
  drop constraint if exists statement_import_rows_user_hash_unique;

create index if not exists statement_import_rows_user_hash_idx
  on public.statement_import_rows (user_id, row_hash);

alter table public.statement_reconciliation_groups
  drop constraint if exists statement_reconciliation_groups_status_valid;

alter table public.statement_reconciliation_groups
  add constraint statement_reconciliation_groups_status_valid check (
    status in (
      'staged',
      'needs_review',
      'confirmed',
      'rejected',
      'imported',
      'ignored',
      'failed'
    )
  );

create table if not exists public.statement_import_review_audit (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.statement_imports(id) on delete cascade,
  group_id uuid not null references public.statement_reconciliation_groups(id) on delete cascade,
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  decision text not null,
  previous_status text,
  next_status text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint statement_import_review_audit_decision_valid check (
    decision in ('confirmed', 'rejected')
  )
);

create index if not exists statement_import_review_audit_import_idx
  on public.statement_import_review_audit (import_id, created_at desc);

alter table public.statement_import_review_audit enable row level security;

create policy "Users can read their own statement import review audit"
  on public.statement_import_review_audit
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own statement import review audit"
  on public.statement_import_review_audit
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      where owner_group.id = group_id
        and owner_group.import_id = import_id
        and owner_group.user_id = (select auth.uid())
    )
  );
