create table if not exists public.wheel_underlying_universe (
  symbol text primary key,
  company_name text not null,
  exchange text not null check (exchange in ('NYSE', 'NASDAQ')),
  optionable boolean not null default true,
  active boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.wheel_underlying_universe enable row level security;

create index if not exists wheel_underlying_universe_exchange_idx
  on public.wheel_underlying_universe (exchange, active, optionable);

create table if not exists public.wheel_universe_scan_runs (
  id uuid primary key default gen_random_uuid(),
  persona text not null,
  strategy text not null,
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  deep_scan_size integer not null default 250,
  total_count integer not null default 0,
  deep_scanned_count integer not null default 0,
  scored_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.wheel_universe_scan_runs enable row level security;

create index if not exists wheel_universe_scan_runs_lookup_idx
  on public.wheel_universe_scan_runs (persona, strategy, status, completed_at desc);

create table if not exists public.wheel_underlying_snapshots (
  symbol text primary key references public.wheel_underlying_universe(symbol) on delete cascade,
  scan_run_id uuid references public.wheel_universe_scan_runs(id) on delete set null,
  price numeric not null,
  latest_trade_at timestamptz,
  daily_volume numeric,
  dollar_volume numeric,
  previous_close numeric,
  pct_change numeric,
  snapshot jsonb not null default '{}'::jsonb,
  captured_at timestamptz not null default now()
);

alter table public.wheel_underlying_snapshots enable row level security;

create index if not exists wheel_underlying_snapshots_volume_idx
  on public.wheel_underlying_snapshots (dollar_volume desc nulls last);

create index if not exists wheel_underlying_snapshots_captured_idx
  on public.wheel_underlying_snapshots (captured_at desc);

create table if not exists public.wheel_underlying_technicals (
  symbol text primary key references public.wheel_underlying_universe(symbol) on delete cascade,
  trend text not null default 'neutral' check (trend in ('bullish', 'neutral', 'bearish')),
  rsi14 numeric,
  ma20 numeric,
  ma50 numeric,
  ma200 numeric,
  last_bar_at timestamptz,
  calculated_at timestamptz not null default now()
);

alter table public.wheel_underlying_technicals enable row level security;

create index if not exists wheel_underlying_technicals_calculated_idx
  on public.wheel_underlying_technicals (calculated_at desc);

create table if not exists public.wheel_option_market_snapshots (
  contract_symbol text primary key,
  scan_run_id uuid references public.wheel_universe_scan_runs(id) on delete set null,
  underlying_symbol text not null references public.wheel_underlying_universe(symbol) on delete cascade,
  option_type text not null check (option_type in ('put', 'call')),
  strike numeric not null,
  expiration date not null,
  bid numeric not null,
  ask numeric not null,
  delta numeric,
  theta numeric,
  implied_volatility numeric,
  volume numeric,
  open_interest numeric,
  captured_at timestamptz not null default now()
);

alter table public.wheel_option_market_snapshots enable row level security;

create index if not exists wheel_option_market_snapshots_underlying_idx
  on public.wheel_option_market_snapshots (underlying_symbol, expiration, option_type);

create index if not exists wheel_option_market_snapshots_captured_idx
  on public.wheel_option_market_snapshots (captured_at desc);

create table if not exists public.wheel_universe_ranked_candidates (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid not null references public.wheel_universe_scan_runs(id) on delete cascade,
  rank integer not null,
  symbol text not null,
  company_name text not null,
  exchange text not null,
  score integer not null,
  strategy text not null,
  expiration date not null,
  dte integer not null,
  short_strike numeric not null,
  long_strike numeric,
  premium_yield numeric,
  annualized_yield numeric,
  return_on_risk numeric,
  annualized_return_on_risk numeric,
  delta numeric,
  implied_volatility numeric,
  liquidity_quality text not null,
  underlying_price numeric not null,
  underlying_as_of timestamptz,
  trend text not null,
  rsi14 numeric,
  ma20 numeric,
  ma50 numeric,
  ma200 numeric,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (scan_run_id, symbol, strategy)
);

alter table public.wheel_universe_ranked_candidates enable row level security;

create index if not exists wheel_universe_ranked_candidates_run_rank_idx
  on public.wheel_universe_ranked_candidates (scan_run_id, rank);

create index if not exists wheel_universe_ranked_candidates_symbol_idx
  on public.wheel_universe_ranked_candidates (symbol, strategy);
