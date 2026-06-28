alter table public.wheel_option_candidates
  add column if not exists premium_received numeric;

alter table public.wheel_universe_ranked_candidates
  add column if not exists premium_received numeric;

alter table public.wheel_deep_scan_candidates
  add column if not exists premium_received numeric;
