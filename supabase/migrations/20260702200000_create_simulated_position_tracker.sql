create table if not exists public.paper_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  starting_cash numeric(14, 2) not null default 0,
  current_cash numeric(14, 2) not null default 0,
  margin_balance numeric(14, 2) not null default 0,
  margin_interest_rate numeric(8, 6) not null default 0.05,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_accounts_user_unique unique (user_id),
  constraint paper_accounts_starting_cash_non_negative check (starting_cash >= 0),
  constraint paper_accounts_margin_balance_non_negative check (margin_balance >= 0),
  constraint paper_accounts_margin_interest_rate_non_negative check (margin_interest_rate >= 0)
);

create trigger paper_accounts_set_updated_at
  before update on public.paper_accounts
  for each row
  execute function public.set_updated_at();

alter table public.paper_accounts enable row level security;

create policy "Users can read their own paper account"
  on public.paper_accounts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own paper account"
  on public.paper_accounts
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own paper account"
  on public.paper_accounts
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own paper account"
  on public.paper_accounts
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.simulated_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  paper_account_id uuid not null references public.paper_accounts(id) on delete cascade,
  source text not null default 'simulated',
  external_source_id text,
  status text not null default 'open',
  strategy_type text not null,
  symbol text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  contracts_opened integer not null,
  contracts_remaining integer not null,
  net_credit numeric(12, 4) not null,
  notes text,
  underlying_price_at_open numeric(14, 4),
  expiration_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simulated_positions_source_not_blank check (btrim(source) <> ''),
  constraint simulated_positions_status_valid check (
    status in (
      'open',
      'partially_closed',
      'closed',
      'expired',
      'assigned',
      'manual_review'
    )
  ),
  constraint simulated_positions_strategy_type_valid check (
    strategy_type in (
      'short_put',
      'covered_call',
      'put_credit_spread',
      'call_credit_spread',
      'custom'
    )
  ),
  constraint simulated_positions_symbol_not_blank check (btrim(symbol) <> ''),
  constraint simulated_positions_contracts_opened_positive check (contracts_opened > 0),
  constraint simulated_positions_contracts_remaining_valid check (
    contracts_remaining >= 0 and contracts_remaining <= contracts_opened
  ),
  constraint simulated_positions_net_credit_non_negative check (net_credit >= 0),
  constraint simulated_positions_underlying_price_positive check (
    underlying_price_at_open is null or underlying_price_at_open > 0
  ),
  constraint simulated_positions_closed_after_open check (
    closed_at is null or closed_at >= opened_at
  )
);

create index if not exists simulated_positions_user_status_idx
  on public.simulated_positions (user_id, status, opened_at desc);

create index if not exists simulated_positions_account_status_idx
  on public.simulated_positions (paper_account_id, status, opened_at desc);

create index if not exists simulated_positions_symbol_idx
  on public.simulated_positions (symbol, opened_at desc);

create trigger simulated_positions_set_updated_at
  before update on public.simulated_positions
  for each row
  execute function public.set_updated_at();

alter table public.simulated_positions enable row level security;

create policy "Users can read their own simulated positions"
  on public.simulated_positions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own simulated positions"
  on public.simulated_positions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.paper_accounts account
      where account.id = paper_account_id
        and account.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own simulated positions"
  on public.simulated_positions
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.paper_accounts account
      where account.id = paper_account_id
        and account.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own simulated positions"
  on public.simulated_positions
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.simulated_position_legs (
  id uuid primary key default gen_random_uuid(),
  position_id uuid not null references public.simulated_positions(id) on delete cascade,
  leg_index integer not null,
  side text not null,
  option_type text,
  contract_symbol text,
  strike numeric(14, 4),
  expiration_date date,
  quantity integer not null,
  open_price numeric(12, 4) not null,
  current_mark numeric(12, 4),
  bid_price numeric(12, 4),
  ask_price numeric(12, 4),
  mid_price numeric(12, 4),
  delta numeric(10, 6),
  gamma numeric(10, 6),
  theta numeric(10, 6),
  vega numeric(10, 6),
  rho numeric(10, 6),
  implied_volatility numeric(10, 6),
  open_interest bigint,
  volume bigint,
  quote_as_of timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simulated_position_legs_index_non_negative check (leg_index >= 0),
  constraint simulated_position_legs_side_valid check (side in ('short', 'long')),
  constraint simulated_position_legs_option_type_valid check (
    option_type is null or option_type in ('put', 'call')
  ),
  constraint simulated_position_legs_quantity_positive check (quantity > 0),
  constraint simulated_position_legs_open_price_non_negative check (open_price >= 0),
  constraint simulated_position_legs_current_mark_non_negative check (
    current_mark is null or current_mark >= 0
  ),
  constraint simulated_position_legs_bid_price_non_negative check (
    bid_price is null or bid_price >= 0
  ),
  constraint simulated_position_legs_ask_price_non_negative check (
    ask_price is null or ask_price >= 0
  ),
  constraint simulated_position_legs_mid_price_non_negative check (
    mid_price is null or mid_price >= 0
  ),
  constraint simulated_position_legs_strike_positive check (
    strike is null or strike > 0
  ),
  constraint simulated_position_legs_open_interest_non_negative check (
    open_interest is null or open_interest >= 0
  ),
  constraint simulated_position_legs_volume_non_negative check (
    volume is null or volume >= 0
  ),
  constraint simulated_position_legs_position_index_unique unique (position_id, leg_index)
);

create index if not exists simulated_position_legs_position_idx
  on public.simulated_position_legs (position_id, leg_index);

create trigger simulated_position_legs_set_updated_at
  before update on public.simulated_position_legs
  for each row
  execute function public.set_updated_at();

alter table public.simulated_position_legs enable row level security;

create policy "Users can read their own simulated position legs"
  on public.simulated_position_legs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.simulated_positions owner_position
      where owner_position.id = position_id
        and owner_position.user_id = (select auth.uid())
    )
  );

create policy "Users can create their own simulated position legs"
  on public.simulated_position_legs
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.simulated_positions owner_position
      where owner_position.id = position_id
        and owner_position.user_id = (select auth.uid())
    )
  );

create policy "Users can update their own simulated position legs"
  on public.simulated_position_legs
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.simulated_positions owner_position
      where owner_position.id = position_id
        and owner_position.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.simulated_positions owner_position
      where owner_position.id = position_id
        and owner_position.user_id = (select auth.uid())
    )
  );

create policy "Users can delete their own simulated position legs"
  on public.simulated_position_legs
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.simulated_positions owner_position
      where owner_position.id = position_id
        and owner_position.user_id = (select auth.uid())
    )
  );

create table if not exists public.simulated_position_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  paper_account_id uuid not null references public.paper_accounts(id) on delete cascade,
  position_id uuid not null references public.simulated_positions(id) on delete cascade,
  event_type text not null,
  quantity integer,
  price numeric(12, 4),
  cash_delta numeric(14, 2) not null default 0,
  realized_pnl_delta numeric(14, 2) not null default 0,
  margin_delta numeric(14, 2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint simulated_position_events_type_valid check (
    event_type in (
      'opened',
      'partial_close',
      'full_close',
      'expired',
      'assigned',
      'cash_adjustment',
      'margin_interest',
      'manual_adjustment',
      'mark_update'
    )
  ),
  constraint simulated_position_events_quantity_non_negative check (
    quantity is null or quantity >= 0
  ),
  constraint simulated_position_events_price_non_negative check (
    price is null or price >= 0
  )
);

create index if not exists simulated_position_events_position_created_idx
  on public.simulated_position_events (position_id, created_at desc);

create index if not exists simulated_position_events_user_created_idx
  on public.simulated_position_events (user_id, created_at desc);

alter table public.simulated_position_events enable row level security;

create policy "Users can read their own simulated position events"
  on public.simulated_position_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own simulated position events"
  on public.simulated_position_events
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.simulated_positions owner_position
      where owner_position.id = position_id
        and owner_position.user_id = (select auth.uid())
        and owner_position.paper_account_id = paper_account_id
    )
  );

create policy "Users can update their own simulated position events"
  on public.simulated_position_events
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.simulated_positions owner_position
      where owner_position.id = position_id
        and owner_position.user_id = (select auth.uid())
        and owner_position.paper_account_id = paper_account_id
    )
  );

create policy "Users can delete their own simulated position events"
  on public.simulated_position_events
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.simulated_equity_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.account_profiles(id) on delete cascade,
  paper_account_id uuid not null references public.paper_accounts(id) on delete cascade,
  symbol text not null,
  shares numeric(18, 6) not null,
  cost_basis numeric(14, 4) not null,
  source_position_id uuid references public.simulated_positions(id) on delete set null,
  acquired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simulated_equity_lots_symbol_not_blank check (btrim(symbol) <> ''),
  constraint simulated_equity_lots_shares_non_zero check (shares <> 0),
  constraint simulated_equity_lots_cost_basis_non_negative check (cost_basis >= 0)
);

create index if not exists simulated_equity_lots_user_symbol_idx
  on public.simulated_equity_lots (user_id, symbol, acquired_at desc);

create index if not exists simulated_equity_lots_account_symbol_idx
  on public.simulated_equity_lots (paper_account_id, symbol, acquired_at desc);

create index if not exists simulated_equity_lots_source_position_idx
  on public.simulated_equity_lots (source_position_id)
  where source_position_id is not null;

create trigger simulated_equity_lots_set_updated_at
  before update on public.simulated_equity_lots
  for each row
  execute function public.set_updated_at();

alter table public.simulated_equity_lots enable row level security;

create policy "Users can read their own simulated equity lots"
  on public.simulated_equity_lots
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own simulated equity lots"
  on public.simulated_equity_lots
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.paper_accounts account
      where account.id = paper_account_id
        and account.user_id = (select auth.uid())
    ) and (
      source_position_id is null or exists (
        select 1
        from public.simulated_positions owner_position
        where owner_position.id = source_position_id
          and owner_position.user_id = (select auth.uid())
          and owner_position.paper_account_id = paper_account_id
      )
    )
  );

create policy "Users can update their own simulated equity lots"
  on public.simulated_equity_lots
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id and
    exists (
      select 1
      from public.paper_accounts account
      where account.id = paper_account_id
        and account.user_id = (select auth.uid())
    ) and (
      source_position_id is null or exists (
        select 1
        from public.simulated_positions owner_position
        where owner_position.id = source_position_id
          and owner_position.user_id = (select auth.uid())
          and owner_position.paper_account_id = paper_account_id
      )
    )
  );

create policy "Users can delete their own simulated equity lots"
  on public.simulated_equity_lots
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);
