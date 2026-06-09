create table if not exists public.wheel_deep_scan_runs (
  id uuid primary key default gen_random_uuid(),
  persona text not null,
  strategy text not null,
  filter_key text not null,
  filters jsonb not null default '{}'::jsonb,
  status text not null default 'running' check (status in ('running', 'complete', 'failed')),
  requested_batch_size integer not null default 100,
  selected_count integer not null default 0,
  scanned_count integer not null default 0,
  candidate_count integer not null default 0,
  error_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.wheel_deep_scan_runs enable row level security;

create index if not exists wheel_deep_scan_runs_lookup_idx
  on public.wheel_deep_scan_runs (persona, strategy, filter_key, status, completed_at desc);

create table if not exists public.wheel_deep_scan_coverage (
  symbol text not null references public.wheel_underlying_universe(symbol) on delete cascade,
  persona text not null,
  strategy text not null,
  filter_key text not null,
  status text not null default 'pending' check (status in ('pending', 'complete', 'failed', 'no_candidate')),
  scan_run_id uuid references public.wheel_deep_scan_runs(id) on delete set null,
  last_scanned_at timestamptz,
  option_contract_count integer not null default 0,
  best_score integer,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (symbol, persona, strategy, filter_key)
);

alter table public.wheel_deep_scan_coverage enable row level security;

create index if not exists wheel_deep_scan_coverage_due_idx
  on public.wheel_deep_scan_coverage (persona, strategy, filter_key, last_scanned_at asc nulls first);

create index if not exists wheel_deep_scan_coverage_status_idx
  on public.wheel_deep_scan_coverage (status, updated_at desc);

create table if not exists public.wheel_deep_scan_candidates (
  id uuid primary key default gen_random_uuid(),
  scan_run_id uuid references public.wheel_deep_scan_runs(id) on delete set null,
  persona text not null,
  strategy text not null,
  filter_key text not null,
  symbol text not null,
  company_name text not null,
  exchange text not null,
  score integer not null,
  option_type text not null check (option_type in ('put', 'call')),
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
  updated_at timestamptz not null default now(),
  unique (persona, strategy, filter_key, symbol)
);

alter table public.wheel_deep_scan_candidates enable row level security;

create index if not exists wheel_deep_scan_candidates_lookup_idx
  on public.wheel_deep_scan_candidates (persona, strategy, filter_key, score desc, symbol);

create index if not exists wheel_deep_scan_candidates_freshness_idx
  on public.wheel_deep_scan_candidates (persona, strategy, filter_key, as_of desc);

create index if not exists wheel_deep_scan_candidates_symbol_idx
  on public.wheel_deep_scan_candidates (symbol, strategy);
