alter table public.wheel_screener_snapshots
  add column if not exists heartbeat_at timestamptz;

update public.wheel_screener_snapshots
set heartbeat_at = coalesce(completed_at, started_at)
where heartbeat_at is null;

alter table public.wheel_screener_snapshots
  alter column heartbeat_at set default now(),
  alter column heartbeat_at set not null;

create index if not exists wheel_screener_snapshots_running_heartbeat_idx
  on public.wheel_screener_snapshots (persona, strategy, filter_key, feed, status, heartbeat_at desc)
  where status = 'running';
