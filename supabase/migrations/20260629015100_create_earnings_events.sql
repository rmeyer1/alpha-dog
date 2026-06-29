create table if not exists public.earnings_events (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  earnings_date date not null,
  hour text,
  year integer,
  quarter integer,
  eps_estimate numeric,
  eps_actual numeric,
  revenue_estimate numeric,
  revenue_actual numeric,
  source text not null default 'finnhub',
  as_of timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint earnings_events_symbol_not_blank check (length(trim(symbol)) > 0),
  constraint earnings_events_unique unique (symbol, earnings_date, source)
);

alter table public.earnings_events enable row level security;

create index if not exists earnings_events_symbol_date_idx
  on public.earnings_events (symbol, earnings_date);

create index if not exists earnings_events_date_idx
  on public.earnings_events (earnings_date);

create table if not exists public.earnings_refresh_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'finnhub',
  from_date date not null,
  to_date date not null,
  status text not null default 'running',
  symbols_count integer not null default 0,
  events_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb
);

alter table public.earnings_refresh_runs enable row level security;

create index if not exists earnings_refresh_runs_latest_idx
  on public.earnings_refresh_runs (source, status, completed_at desc);
