create table if not exists public.statement_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  broker text not null,
  file_name text not null,
  file_hash text not null,
  status text not null default 'uploaded',
  imported_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statement_imports_broker_not_blank check (btrim(broker) <> ''),
  constraint statement_imports_file_name_not_blank check (btrim(file_name) <> ''),
  constraint statement_imports_file_hash_not_blank check (btrim(file_hash) <> ''),
  constraint statement_imports_status_valid check (
    status in (
      'uploaded',
      'parsed',
      'needs_review',
      'imported',
      'failed'
    )
  ),
  constraint statement_imports_user_broker_file_unique unique (user_id, broker, file_hash)
);

create index if not exists statement_imports_user_created_idx
  on public.statement_imports (user_id, created_at desc);

create index if not exists statement_imports_user_status_idx
  on public.statement_imports (user_id, status, created_at desc);

create trigger statement_imports_set_updated_at
  before update on public.statement_imports
  for each row
  execute function public.set_updated_at();

alter table public.statement_imports enable row level security;

create policy "Users can read their own statement imports"
  on public.statement_imports
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own statement imports"
  on public.statement_imports
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own statement imports"
  on public.statement_imports
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own statement imports"
  on public.statement_imports
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.statement_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.statement_imports(id) on delete cascade,
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  row_index integer not null,
  row_hash text not null,
  raw_row jsonb not null,
  activity_date date,
  process_date date,
  settle_date date,
  instrument text,
  description text,
  trans_code text,
  quantity numeric(18, 6),
  price numeric(14, 6),
  amount numeric(14, 2),
  classification text not null default 'unknown',
  confidence numeric(5, 4),
  status text not null default 'staged',
  created_at timestamptz not null default now(),
  constraint statement_import_rows_index_non_negative check (row_index >= 0),
  constraint statement_import_rows_hash_not_blank check (btrim(row_hash) <> ''),
  constraint statement_import_rows_confidence_valid check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint statement_import_rows_classification_valid check (
    classification in (
      'option',
      'equity',
      'dividend',
      'cash',
      'ignored',
      'out_of_scope',
      'unknown'
    )
  ),
  constraint statement_import_rows_status_valid check (
    status in (
      'staged',
      'duplicate',
      'ignored',
      'needs_review',
      'imported',
      'failed'
    )
  ),
  constraint statement_import_rows_import_index_unique unique (import_id, row_index),
  constraint statement_import_rows_user_hash_unique unique (user_id, row_hash)
);

create index if not exists statement_import_rows_import_status_idx
  on public.statement_import_rows (import_id, status, row_index);

create index if not exists statement_import_rows_user_classification_idx
  on public.statement_import_rows (user_id, classification, status, activity_date desc);

alter table public.statement_import_rows enable row level security;

create policy "Users can read their own statement import rows"
  on public.statement_import_rows
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own statement import rows"
  on public.statement_import_rows
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.statement_imports owner_import
      where owner_import.id = import_id
        and owner_import.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own statement import rows"
  on public.statement_import_rows
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.statement_imports owner_import
      where owner_import.id = import_id
        and owner_import.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own statement import rows"
  on public.statement_import_rows
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.statement_reconciliation_groups (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.statement_imports(id) on delete cascade,
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  group_type text not null,
  symbol text,
  strategy_type text,
  confidence numeric(5, 4),
  status text not null default 'staged',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint statement_reconciliation_groups_group_type_valid check (
    group_type in (
      'option_strategy',
      'equity_position',
      'dividend',
      'cash_activity',
      'unknown'
    )
  ),
  constraint statement_reconciliation_groups_strategy_type_valid check (
    strategy_type is null or strategy_type in (
      'short_put',
      'covered_call',
      'put_credit_spread',
      'call_credit_spread',
      'equity',
      'dividend',
      'custom'
    )
  ),
  constraint statement_reconciliation_groups_confidence_valid check (
    confidence is null or (confidence >= 0 and confidence <= 1)
  ),
  constraint statement_reconciliation_groups_status_valid check (
    status in (
      'staged',
      'needs_review',
      'confirmed',
      'imported',
      'ignored',
      'failed'
    )
  )
);

create index if not exists statement_reconciliation_groups_import_status_idx
  on public.statement_reconciliation_groups (import_id, status, created_at desc);

create index if not exists statement_reconciliation_groups_user_symbol_idx
  on public.statement_reconciliation_groups (user_id, symbol, created_at desc)
  where symbol is not null;

create trigger statement_reconciliation_groups_set_updated_at
  before update on public.statement_reconciliation_groups
  for each row
  execute function public.set_updated_at();

alter table public.statement_reconciliation_groups enable row level security;

create policy "Users can read their own statement reconciliation groups"
  on public.statement_reconciliation_groups
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own statement reconciliation groups"
  on public.statement_reconciliation_groups
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.statement_imports owner_import
      where owner_import.id = import_id
        and owner_import.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own statement reconciliation groups"
  on public.statement_reconciliation_groups
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.statement_imports owner_import
      where owner_import.id = import_id
        and owner_import.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own statement reconciliation groups"
  on public.statement_reconciliation_groups
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.statement_reconciliation_group_rows (
  group_id uuid not null references public.statement_reconciliation_groups(id) on delete cascade,
  row_id uuid not null references public.statement_import_rows(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  primary key (group_id, row_id),
  constraint statement_reconciliation_group_rows_role_not_blank check (btrim(role) <> '')
);

create index if not exists statement_reconciliation_group_rows_row_idx
  on public.statement_reconciliation_group_rows (row_id);

alter table public.statement_reconciliation_group_rows enable row level security;

create policy "Users can read their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_import_rows owner_row
        on owner_row.id = row_id
      where owner_group.id = group_id
        and owner_group.user_id = (select auth.uid())
        and owner_row.user_id = (select auth.uid())
    )
  );

create policy "Users can create their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_import_rows owner_row
        on owner_row.id = row_id
      where owner_group.id = group_id
        and owner_group.user_id = (select auth.uid())
        and owner_row.user_id = (select auth.uid())
        and owner_group.import_id = owner_row.import_id
    )
  );

create policy "Users can update their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_import_rows owner_row
        on owner_row.id = row_id
      where owner_group.id = group_id
        and owner_group.user_id = (select auth.uid())
        and owner_row.user_id = (select auth.uid())
        and owner_group.import_id = owner_row.import_id
    )
  )
  with check (
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_import_rows owner_row
        on owner_row.id = row_id
      where owner_group.id = group_id
        and owner_group.user_id = (select auth.uid())
        and owner_row.user_id = (select auth.uid())
        and owner_group.import_id = owner_row.import_id
    )
  );

create policy "Users can delete their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_import_rows owner_row
        on owner_row.id = row_id
      where owner_group.id = group_id
        and owner_group.user_id = (select auth.uid())
        and owner_row.user_id = (select auth.uid())
    )
  );
