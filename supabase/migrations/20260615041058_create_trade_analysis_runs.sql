create table if not exists public.trade_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  persona text not null,
  strategy text not null,
  source text not null,
  candidate_type text not null check (candidate_type in ('contract', 'vertical_spread')),
  candidate_identity jsonb not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  chart_source text check (chart_source in ('server_chart_indicators')),
  request_payload jsonb not null,
  response_payload jsonb,
  verdict text check (verdict in ('validate', 'invalidate', 'needs_confirmation', 'no_trade')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status text not null default 'completed' check (status in ('completed', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

alter table public.trade_analysis_runs enable row level security;

create index if not exists trade_analysis_runs_symbol_created_idx
  on public.trade_analysis_runs (symbol, created_at desc);

create index if not exists trade_analysis_runs_candidate_idx
  on public.trade_analysis_runs (symbol, strategy, candidate_type, created_at desc);

create index if not exists trade_analysis_runs_verdict_idx
  on public.trade_analysis_runs (verdict, created_at desc);
