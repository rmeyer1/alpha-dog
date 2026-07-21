alter table public.simulated_equity_lots
  add column if not exists source_fingerprint text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_equity_lots_source_fingerprint_not_blank'
      and conrelid = 'public.simulated_equity_lots'::regclass
  ) then
    alter table public.simulated_equity_lots
      add constraint simulated_equity_lots_source_fingerprint_not_blank
      check (source_fingerprint is null or btrim(source_fingerprint) <> '');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_positions_statement_import_source_required'
      and conrelid = 'public.simulated_positions'::regclass
  ) then
    alter table public.simulated_positions
      add constraint simulated_positions_statement_import_source_required
      check (
        source <> 'statement_import' or
        nullif(btrim(external_source_id), '') is not null
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'simulated_position_events_statement_import_key_required'
      and conrelid = 'public.simulated_position_events'::regclass
  ) then
    alter table public.simulated_position_events
      add constraint simulated_position_events_statement_import_key_required
      check (
        metadata->>'source' is distinct from 'statement_import' or
        nullif(btrim(metadata->>'idempotencyKey'), '') is not null
      );
  end if;
end;
$$;

create unique index if not exists simulated_positions_statement_import_source_unique
  on public.simulated_positions (user_id, external_source_id)
  where source = 'statement_import' and external_source_id is not null;

create unique index if not exists simulated_position_events_statement_import_key_unique
  on public.simulated_position_events (
    user_id,
    position_id,
    (metadata->>'idempotencyKey')
  )
  where metadata->>'source' = 'statement_import'
    and metadata->>'idempotencyKey' is not null;

create unique index if not exists simulated_equity_lots_statement_import_source_unique
  on public.simulated_equity_lots (user_id, source_fingerprint)
  where source_fingerprint is not null;

create or replace function public.finalize_statement_import_atomic(
  p_user_id uuid,
  p_positions jsonb default '[]'::jsonb,
  p_equity_lots jsonb default '[]'::jsonb,
  p_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account public.paper_accounts%rowtype;
  v_position public.simulated_positions%rowtype;
  v_position_input jsonb;
  v_position_body jsonb;
  v_leg jsonb;
  v_event jsonb;
  v_lot jsonb;
  v_inserted_positions integer := 0;
  v_inserted_events integer := 0;
  v_inserted_equity_lots integer := 0;
  v_skipped_positions integer := 0;
  v_skipped_equity_lots integer := 0;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED: Sign in to import broker statements.';
  end if;

  if p_user_id is distinct from v_user_id then
    raise exception 'STATEMENT_IMPORT_OWNER_MISMATCH: Statement import owner mismatch.';
  end if;

  insert into public.paper_accounts (user_id)
  values (v_user_id)
  on conflict (user_id) do nothing;

  select *
  into strict v_account
  from public.paper_accounts
  where user_id = v_user_id;

  for v_position_input in
    select value
    from jsonb_array_elements(coalesce(p_positions, '[]'::jsonb)) as positions(value)
  loop
    v_position_body := coalesce(v_position_input->'position', '{}'::jsonb);

    if nullif(btrim(v_position_input->>'externalSourceId'), '') is null then
      raise exception 'STATEMENT_IMPORT_POSITION_FINGERPRINT_REQUIRED: Position fingerprint is required.';
    end if;

    v_position := null;

    insert into public.simulated_positions (
      user_id,
      paper_account_id,
      source,
      external_source_id,
      status,
      strategy_type,
      symbol,
      opened_at,
      closed_at,
      contracts_opened,
      contracts_remaining,
      net_credit,
      notes,
      underlying_price_at_open,
      expiration_date
    )
    values (
      v_user_id,
      v_account.id,
      'statement_import',
      nullif(btrim(v_position_input->>'externalSourceId'), ''),
      v_position_body->>'status',
      v_position_body->>'strategy_type',
      upper(v_position_body->>'symbol'),
      (v_position_body->>'opened_at')::timestamptz,
      nullif(v_position_body->>'closed_at', '')::timestamptz,
      (v_position_body->>'contracts_opened')::integer,
      (v_position_body->>'contracts_remaining')::integer,
      (v_position_body->>'net_credit')::numeric,
      nullif(v_position_body->>'notes', ''),
      nullif(v_position_body->>'underlying_price_at_open', '')::numeric,
      nullif(v_position_body->>'expiration_date', '')::date
    )
    on conflict (user_id, external_source_id)
      where source = 'statement_import' and external_source_id is not null
    do nothing
    returning * into v_position;

    if v_position.id is null then
      v_skipped_positions := v_skipped_positions + 1;
      continue;
    end if;

    v_inserted_positions := v_inserted_positions + 1;

    for v_leg in
      select value
      from jsonb_array_elements(coalesce(v_position_input->'legs', '[]'::jsonb)) as legs(value)
    loop
      insert into public.simulated_position_legs (
        position_id,
        leg_index,
        side,
        option_type,
        contract_symbol,
        strike,
        expiration_date,
        quantity,
        open_price,
        snapshot
      )
      values (
        v_position.id,
        (v_leg->>'leg_index')::integer,
        v_leg->>'side',
        nullif(v_leg->>'option_type', ''),
        nullif(v_leg->>'contract_symbol', ''),
        nullif(v_leg->>'strike', '')::numeric,
        nullif(v_leg->>'expiration_date', '')::date,
        (v_leg->>'quantity')::integer,
        (v_leg->>'open_price')::numeric,
        coalesce(v_leg->'snapshot', '{}'::jsonb)
      );
    end loop;

    for v_event in
      select value
      from jsonb_array_elements(coalesce(v_position_input->'events', '[]'::jsonb)) as events(value)
    loop
      if nullif(btrim(v_event->'metadata'->>'idempotencyKey'), '') is null then
        raise exception 'STATEMENT_IMPORT_EVENT_KEY_REQUIRED: Event idempotency key is required.';
      end if;

      insert into public.simulated_position_events (
        user_id,
        paper_account_id,
        position_id,
        event_type,
        quantity,
        price,
        cash_delta,
        realized_pnl_delta,
        margin_delta,
        metadata,
        created_at
      )
      values (
        v_user_id,
        v_account.id,
        v_position.id,
        v_event->>'event_type',
        nullif(v_event->>'quantity', '')::integer,
        nullif(v_event->>'price', '')::numeric,
        (v_event->>'cash_delta')::numeric,
        (v_event->>'realized_pnl_delta')::numeric,
        (v_event->>'margin_delta')::numeric,
        coalesce(v_event->'metadata', '{}'::jsonb) || jsonb_build_object('source', 'statement_import'),
        (v_event->>'created_at')::timestamptz
      );

      v_inserted_events := v_inserted_events + 1;
    end loop;

    v_position := null;
  end loop;

  for v_lot in
    select value
    from jsonb_array_elements(coalesce(p_equity_lots, '[]'::jsonb)) as lots(value)
  loop
    if nullif(btrim(v_lot->>'sourceFingerprint'), '') is null then
      raise exception 'STATEMENT_IMPORT_EQUITY_FINGERPRINT_REQUIRED: Equity fingerprint is required.';
    end if;

    insert into public.simulated_equity_lots (
      user_id,
      paper_account_id,
      symbol,
      shares,
      cost_basis,
      source_position_id,
      source_fingerprint,
      acquired_at
    )
    values (
      v_user_id,
      v_account.id,
      upper(v_lot->>'symbol'),
      (v_lot->>'shares')::numeric,
      (v_lot->>'costBasis')::numeric,
      null,
      nullif(btrim(v_lot->>'sourceFingerprint'), ''),
      (v_lot->>'acquiredAt')::timestamptz
    )
    on conflict (user_id, source_fingerprint)
      where source_fingerprint is not null
    do nothing;

    if found then
      v_inserted_equity_lots := v_inserted_equity_lots + 1;
    else
      v_skipped_equity_lots := v_skipped_equity_lots + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'insertedPositions', v_inserted_positions,
    'insertedEvents', v_inserted_events,
    'insertedEquityLots', v_inserted_equity_lots,
    'skippedPositions', v_skipped_positions,
    'skippedEquityLots', v_skipped_equity_lots,
    'summary', coalesce(p_summary, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.finalize_statement_import_atomic(uuid, jsonb, jsonb, jsonb)
  from public, anon;

grant select, insert on table public.paper_accounts to authenticated;
grant select, insert on table public.simulated_positions to authenticated;
grant insert on table public.simulated_position_legs to authenticated;
grant insert on table public.simulated_position_events to authenticated;
grant select, insert on table public.simulated_equity_lots to authenticated;

grant execute on function public.finalize_statement_import_atomic(uuid, jsonb, jsonb, jsonb)
  to authenticated;
