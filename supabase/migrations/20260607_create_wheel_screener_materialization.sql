create table if not exists public.wheel_screener_snapshots (
  id uuid primary key default gen_random_uuid(),
  persona text not null,
  strategy text not null,
  filter_key text not null,
  filters jsonb not null default '{}'::jsonb,
  feed text not null,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  total_count integer not null default 0,
  processed_count integer not null default 0,
  skipped_count integer not null default 0,
  error text,
  created_at timestamptz not null default now()
);

alter table public.wheel_screener_snapshots enable row level security;

create index if not exists wheel_screener_snapshots_lookup_idx
  on public.wheel_screener_snapshots (persona, strategy, filter_key, feed, status, completed_at desc);

create table if not exists public.wheel_option_candidates (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.wheel_screener_snapshots(id) on delete cascade,
  persona text not null,
  strategy text not null,
  symbol text not null,
  company_name text not null,
  exchange text not null,
  score integer not null,
  option_type text not null,
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
  warning_count integer not null default 0,
  underlying_price numeric not null,
  underlying_as_of timestamptz,
  trend text not null,
  rsi14 numeric,
  ma20 numeric,
  ma50 numeric,
  ma200 numeric,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  as_of timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (snapshot_id, symbol, strategy)
);

alter table public.wheel_option_candidates enable row level security;

create index if not exists wheel_option_candidates_snapshot_score_idx
  on public.wheel_option_candidates (snapshot_id, strategy, score desc);

create index if not exists wheel_option_candidates_strategy_expiration_idx
  on public.wheel_option_candidates (strategy, expiration);

create index if not exists wheel_option_candidates_strategy_delta_idx
  on public.wheel_option_candidates (strategy, delta);

create index if not exists wheel_option_candidates_symbol_strategy_idx
  on public.wheel_option_candidates (symbol, strategy);

create index if not exists wheel_option_candidates_strategy_yield_idx
  on public.wheel_option_candidates (strategy, premium_yield desc nulls last);

create index if not exists wheel_option_candidates_strategy_ror_idx
  on public.wheel_option_candidates (strategy, return_on_risk desc nulls last);
