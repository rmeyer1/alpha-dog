-- Make account-owned Data API reachability independent of project defaults.
-- RLS remains the row-level boundary; these grants define the object-level API.
grant usage on schema public to anon, authenticated, service_role;

revoke all privileges on table
  public.account_profiles,
  public.account_identities,
  public.saved_presets,
  public.analysis_requests,
  public.paper_accounts,
  public.simulated_positions,
  public.simulated_position_legs,
  public.simulated_position_events,
  public.simulated_equity_lots,
  public.statement_imports,
  public.statement_import_rows,
  public.statement_reconciliation_groups,
  public.statement_reconciliation_group_rows,
  public.statement_import_review_audit
from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.account_profiles,
  public.account_identities,
  public.saved_presets,
  public.analysis_requests,
  public.paper_accounts,
  public.simulated_positions,
  public.simulated_position_legs,
  public.simulated_position_events,
  public.simulated_equity_lots,
  public.statement_imports,
  public.statement_import_rows,
  public.statement_reconciliation_groups,
  public.statement_reconciliation_group_rows
to authenticated;

grant select, insert on table
  public.statement_import_review_audit
to authenticated;

grant select, insert, update, delete on table
  public.account_profiles,
  public.account_identities,
  public.saved_presets,
  public.analysis_requests,
  public.paper_accounts,
  public.simulated_positions,
  public.simulated_position_legs,
  public.simulated_position_events,
  public.simulated_equity_lots,
  public.statement_imports,
  public.statement_import_rows,
  public.statement_reconciliation_groups,
  public.statement_reconciliation_group_rows,
  public.statement_import_review_audit
to service_role;

-- PostgreSQL grants EXECUTE to PUBLIC on new functions by default. Revoke every
-- inherited/explicit path first, then expose lifecycle RPCs only to signed-in
-- callers. The service role verifies table access directly and does not need
-- these user-lifecycle entry points.
revoke all on function public.open_simulated_position_atomic(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.close_simulated_position_atomic(
  uuid,
  numeric,
  integer,
  timestamptz,
  text
) from public, anon, authenticated, service_role;
revoke all on function public.expire_simulated_position_atomic(
  uuid,
  numeric,
  timestamptz,
  text
) from public, anon, authenticated, service_role;
revoke all on function public.finalize_statement_import_atomic(
  uuid,
  jsonb,
  jsonb,
  jsonb
) from public, anon, authenticated, service_role;

alter function public.open_simulated_position_atomic(jsonb)
  security invoker;
alter function public.open_simulated_position_atomic(jsonb)
  set search_path = '';

alter function public.close_simulated_position_atomic(
  uuid,
  numeric,
  integer,
  timestamptz,
  text
) security invoker;
alter function public.close_simulated_position_atomic(
  uuid,
  numeric,
  integer,
  timestamptz,
  text
) set search_path = '';

alter function public.expire_simulated_position_atomic(
  uuid,
  numeric,
  timestamptz,
  text
) security invoker;
alter function public.expire_simulated_position_atomic(
  uuid,
  numeric,
  timestamptz,
  text
) set search_path = '';

alter function public.finalize_statement_import_atomic(
  uuid,
  jsonb,
  jsonb,
  jsonb
) security invoker;
alter function public.finalize_statement_import_atomic(
  uuid,
  jsonb,
  jsonb,
  jsonb
) set search_path = '';

grant execute on function public.open_simulated_position_atomic(jsonb)
  to authenticated;
grant execute on function public.close_simulated_position_atomic(
  uuid,
  numeric,
  integer,
  timestamptz,
  text
) to authenticated;
grant execute on function public.expire_simulated_position_atomic(
  uuid,
  numeric,
  timestamptz,
  text
) to authenticated;
grant execute on function public.finalize_statement_import_atomic(
  uuid,
  jsonb,
  jsonb,
  jsonb
) to authenticated;

-- Cover ownership foreign keys used by RLS joins and cascades.
create index if not exists simulated_position_events_paper_account_idx
  on public.simulated_position_events (paper_account_id);

create index if not exists statement_import_review_audit_group_idx
  on public.statement_import_review_audit (group_id);

create index if not exists statement_import_review_audit_user_idx
  on public.statement_import_review_audit (user_id);

-- Rebuild graph policies with explicit outer-column qualification. Without it,
-- identically named columns in a subquery can shadow the protected row and turn
-- a parent relationship check into a tautology.
drop policy if exists "Users can read their own simulated position events"
  on public.simulated_position_events;
drop policy if exists "Users can create their own simulated position events"
  on public.simulated_position_events;
drop policy if exists "Users can update their own simulated position events"
  on public.simulated_position_events;
drop policy if exists "Users can delete their own simulated position events"
  on public.simulated_position_events;

create policy "Users can read their own simulated position events"
  on public.simulated_position_events
  for select
  to authenticated
  using (
    (select auth.uid()) = simulated_position_events.user_id and
    exists (
      select 1
      from public.simulated_positions owner_position
      join public.paper_accounts owner_account
        on owner_account.id = simulated_position_events.paper_account_id
      where owner_position.id = simulated_position_events.position_id
        and owner_position.user_id = (select auth.uid())
        and owner_position.paper_account_id =
          simulated_position_events.paper_account_id
        and owner_account.user_id = (select auth.uid())
    )
  );

create policy "Users can create their own simulated position events"
  on public.simulated_position_events
  for insert
  to authenticated
  with check (
    (select auth.uid()) = simulated_position_events.user_id and
    exists (
      select 1
      from public.simulated_positions owner_position
      join public.paper_accounts owner_account
        on owner_account.id = simulated_position_events.paper_account_id
      where owner_position.id = simulated_position_events.position_id
        and owner_position.user_id = (select auth.uid())
        and owner_position.paper_account_id =
          simulated_position_events.paper_account_id
        and owner_account.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own simulated position events"
  on public.simulated_position_events
  for update
  to authenticated
  using (
    (select auth.uid()) = simulated_position_events.user_id and
    exists (
      select 1
      from public.simulated_positions owner_position
      join public.paper_accounts owner_account
        on owner_account.id = simulated_position_events.paper_account_id
      where owner_position.id = simulated_position_events.position_id
        and owner_position.user_id = (select auth.uid())
        and owner_position.paper_account_id =
          simulated_position_events.paper_account_id
        and owner_account.user_id = (select auth.uid())
    )
  )
  with check (
    (select auth.uid()) = simulated_position_events.user_id and
    exists (
      select 1
      from public.simulated_positions owner_position
      join public.paper_accounts owner_account
        on owner_account.id = simulated_position_events.paper_account_id
      where owner_position.id = simulated_position_events.position_id
        and owner_position.user_id = (select auth.uid())
        and owner_position.paper_account_id =
          simulated_position_events.paper_account_id
        and owner_account.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own simulated position events"
  on public.simulated_position_events
  for delete
  to authenticated
  using (
    (select auth.uid()) = simulated_position_events.user_id and
    exists (
      select 1
      from public.simulated_positions owner_position
      join public.paper_accounts owner_account
        on owner_account.id = simulated_position_events.paper_account_id
      where owner_position.id = simulated_position_events.position_id
        and owner_position.user_id = (select auth.uid())
        and owner_position.paper_account_id =
          simulated_position_events.paper_account_id
        and owner_account.user_id = (select auth.uid())
    )
  );

drop policy if exists "Users can read their own simulated equity lots"
  on public.simulated_equity_lots;
drop policy if exists "Users can create their own simulated equity lots"
  on public.simulated_equity_lots;
drop policy if exists "Users can update their own simulated equity lots"
  on public.simulated_equity_lots;
drop policy if exists "Users can delete their own simulated equity lots"
  on public.simulated_equity_lots;

create policy "Users can read their own simulated equity lots"
  on public.simulated_equity_lots
  for select
  to authenticated
  using (
    (select auth.uid()) = simulated_equity_lots.user_id and
    exists (
      select 1
      from public.paper_accounts owner_account
      where owner_account.id = simulated_equity_lots.paper_account_id
        and owner_account.user_id = (select auth.uid())
    ) and (
      simulated_equity_lots.source_position_id is null or
      exists (
        select 1
        from public.simulated_positions owner_position
        where owner_position.id = simulated_equity_lots.source_position_id
          and owner_position.user_id = (select auth.uid())
          and owner_position.paper_account_id =
            simulated_equity_lots.paper_account_id
      )
    )
  );

create policy "Users can create their own simulated equity lots"
  on public.simulated_equity_lots
  for insert
  to authenticated
  with check (
    (select auth.uid()) = simulated_equity_lots.user_id and
    exists (
      select 1
      from public.paper_accounts owner_account
      where owner_account.id = simulated_equity_lots.paper_account_id
        and owner_account.user_id = (select auth.uid())
    ) and (
      simulated_equity_lots.source_position_id is null or
      exists (
        select 1
        from public.simulated_positions owner_position
        where owner_position.id = simulated_equity_lots.source_position_id
          and owner_position.user_id = (select auth.uid())
          and owner_position.paper_account_id =
            simulated_equity_lots.paper_account_id
      )
    )
  );

create policy "Users can update their own simulated equity lots"
  on public.simulated_equity_lots
  for update
  to authenticated
  using (
    (select auth.uid()) = simulated_equity_lots.user_id and
    exists (
      select 1
      from public.paper_accounts owner_account
      where owner_account.id = simulated_equity_lots.paper_account_id
        and owner_account.user_id = (select auth.uid())
    ) and (
      simulated_equity_lots.source_position_id is null or
      exists (
        select 1
        from public.simulated_positions owner_position
        where owner_position.id = simulated_equity_lots.source_position_id
          and owner_position.user_id = (select auth.uid())
          and owner_position.paper_account_id =
            simulated_equity_lots.paper_account_id
      )
    )
  )
  with check (
    (select auth.uid()) = simulated_equity_lots.user_id and
    exists (
      select 1
      from public.paper_accounts owner_account
      where owner_account.id = simulated_equity_lots.paper_account_id
        and owner_account.user_id = (select auth.uid())
    ) and (
      simulated_equity_lots.source_position_id is null or
      exists (
        select 1
        from public.simulated_positions owner_position
        where owner_position.id = simulated_equity_lots.source_position_id
          and owner_position.user_id = (select auth.uid())
          and owner_position.paper_account_id =
            simulated_equity_lots.paper_account_id
      )
    )
  );

create policy "Users can delete their own simulated equity lots"
  on public.simulated_equity_lots
  for delete
  to authenticated
  using (
    (select auth.uid()) = simulated_equity_lots.user_id and
    exists (
      select 1
      from public.paper_accounts owner_account
      where owner_account.id = simulated_equity_lots.paper_account_id
        and owner_account.user_id = (select auth.uid())
    ) and (
      simulated_equity_lots.source_position_id is null or
      exists (
        select 1
        from public.simulated_positions owner_position
        where owner_position.id = simulated_equity_lots.source_position_id
          and owner_position.user_id = (select auth.uid())
          and owner_position.paper_account_id =
            simulated_equity_lots.paper_account_id
      )
    )
  );

drop policy if exists "Users can read their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows;
drop policy if exists "Users can create their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows;
drop policy if exists "Users can update their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows;
drop policy if exists "Users can delete their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows;

create policy "Users can read their own statement reconciliation group rows"
  on public.statement_reconciliation_group_rows
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_import_rows owner_row
        on owner_row.id = statement_reconciliation_group_rows.row_id
      where owner_group.id = statement_reconciliation_group_rows.group_id
        and owner_group.user_id = (select auth.uid())
        and owner_row.user_id = (select auth.uid())
        and owner_group.import_id = owner_row.import_id
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
        on owner_row.id = statement_reconciliation_group_rows.row_id
      where owner_group.id = statement_reconciliation_group_rows.group_id
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
        on owner_row.id = statement_reconciliation_group_rows.row_id
      where owner_group.id = statement_reconciliation_group_rows.group_id
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
        on owner_row.id = statement_reconciliation_group_rows.row_id
      where owner_group.id = statement_reconciliation_group_rows.group_id
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
        on owner_row.id = statement_reconciliation_group_rows.row_id
      where owner_group.id = statement_reconciliation_group_rows.group_id
        and owner_group.user_id = (select auth.uid())
        and owner_row.user_id = (select auth.uid())
        and owner_group.import_id = owner_row.import_id
    )
  );

drop policy if exists "Users can read their own statement import review audit"
  on public.statement_import_review_audit;
drop policy if exists "Users can create their own statement import review audit"
  on public.statement_import_review_audit;

create policy "Users can read their own statement import review audit"
  on public.statement_import_review_audit
  for select
  to authenticated
  using (
    (select auth.uid()) = statement_import_review_audit.user_id and
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_imports owner_import
        on owner_import.id = statement_import_review_audit.import_id
      where owner_group.id = statement_import_review_audit.group_id
        and owner_group.import_id =
          statement_import_review_audit.import_id
        and owner_group.user_id = (select auth.uid())
        and owner_import.user_id = (select auth.uid())
    )
  );

create policy "Users can create their own statement import review audit"
  on public.statement_import_review_audit
  for insert
  to authenticated
  with check (
    (select auth.uid()) = statement_import_review_audit.user_id and
    exists (
      select 1
      from public.statement_reconciliation_groups owner_group
      join public.statement_imports owner_import
        on owner_import.id = statement_import_review_audit.import_id
      where owner_group.id = statement_import_review_audit.group_id
        and owner_group.import_id =
          statement_import_review_audit.import_id
        and owner_group.user_id = (select auth.uid())
        and owner_import.user_id = (select auth.uid())
    )
  );
