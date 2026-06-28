create index if not exists wheel_underlying_snapshots_scan_run_idx
  on public.wheel_underlying_snapshots (scan_run_id);

create index if not exists wheel_option_market_snapshots_scan_run_idx
  on public.wheel_option_market_snapshots (scan_run_id);
