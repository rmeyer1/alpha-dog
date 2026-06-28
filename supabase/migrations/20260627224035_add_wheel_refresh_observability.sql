alter table public.wheel_universe_scan_runs
  add column if not exists summary jsonb not null default '{}'::jsonb;

alter table public.wheel_deep_scan_runs
  add column if not exists summary jsonb not null default '{}'::jsonb;
