# Scanner Concurrency and Durable Publication

AD-017 hardens the scheduled universe and deep-scan paths without changing
ranking formulas or public wheel response shapes.

## Ownership

Every live universe or deep scan acquires one database lease for its normalized
scan context before provider work starts. The schedule interval is recorded on
the lease for observability but is not part of the ownership key, so a slow
scan cannot overlap the next interval for the same context.

- Universe scans use 15-minute intervals.
- Deep scans use 60-minute intervals.
- A PostgreSQL advisory transaction lock serializes acquisition for one lease
  key.
- The lease key always hashes the complete normalized scan context. Contexts
  longer than the database's 500-character audit field are stored there as
  the same SHA-256 digest, while scan-run rows retain the complete filters.
- An unexpired lease can only be renewed or released by its owner UUID.
- An expired lease can be atomically reclaimed by a new owner.
- Leases expire after 60 minutes if a worker disappears.

The lease table and RPCs are restricted to `service_role`. RLS remains enabled
on the table, and `anon` and `authenticated` receive no table or function
access. This also keeps the table private under Supabase's evolving Data API
exposure defaults described in the
[Supabase breaking-change notice](https://supabase.com/changelog?types=breaking-change).

## Deadlock Locality

Every scanner upsert sorts the complete row set by its declared conflict-key
columns before splitting it into 500-row chunks. Only PostgreSQL `40P01`
failures are retried. Each failed chunk gets at most three bounded,
jittered retries; completed chunks and provider calls are not repeated.
Non-deadlock failures fail immediately.

Retry attempts emit `wheel_scanner_deadlock_retry` or
`wheel_scanner_run_write_deadlock_retry` with the table, chunk or run ID,
attempt, and delay. No credentials or row values are logged.

## Workflow Boundary

The deep-scan Workflow now has separate durable stages:

1. Provider work and idempotent fact/candidate persistence.
2. A database checkpoint containing the result.
3. Publication completion using only the scan run ID.

The first stage returns only the run ID. A late publication failure therefore
retries the publication step and reads its checkpoint instead of repeating
asset, stock, technical, or option-provider calls. This follows Vercel's
[durable step model](https://vercel.com/docs/workflows/concepts), where
completed steps are persisted and recovery resumes at the failed boundary.
The trigger gives each Workflow a stable idempotency key, and the stage derives
its database lease owner from that key. If an invocation result is lost, the
retry reuses the same running row and
returns an existing checkpoint without replaying provider work.

Screener batches already keep provider analysis and candidate/snapshot
publication in separate Workflow steps. Snapshot and scan-run heartbeats now
advance after real progress instead of remaining at their insert defaults.

## Trigger Status and Schedule

Cron responses keep Workflow runtime status for compatibility and also report:

- `enqueueStatus: "accepted"`
- `completionStatus: "pending" | "complete"`
- top-level `enqueueSucceeded`
- top-level `publicationCompleted`

An HTTP 200 from a trigger means enqueue succeeded; it does not claim that
publication completed. Completion is only reported when the Workflow runtime
already returns `completed`; newly accepted work normally remains pending.

The screener runs at minutes 7, 22, 37, and 52 during the relevant weekday UTC
window. Deep coverage runs at minute 10, including the next-UTC-day tail needed
to retain 7-8 p.m. New York coverage. Route-level New York time guards remain
authoritative across daylight-saving changes and manual dispatches.

## Rollout

Apply `supabase/migrations/20260723234909_stabilize_scanner_concurrency.sql`
before merging or deploying the application revision. The migration is
additive and leaves existing response data unchanged.

After applying it, verify:

```sql
select lease_key, owner_id, scan_kind, heartbeat_at, expires_at
from public.wheel_scan_leases
order by expires_at desc;

select id, status, started_at, heartbeat_at, completed_at
from public.wheel_universe_scan_runs
order by started_at desc
limit 20;

select id, status, started_at, heartbeat_at, completed_at,
       workflow_result is not null as has_workflow_checkpoint
from public.wheel_deep_scan_runs
order by started_at desc
limit 20;
```

Run Supabase security and performance advisors after applying the migration.
The new covering indexes intentionally resolve the pre-rollout unindexed
foreign-key findings for deep-scan run references; see the
[Supabase database linter guide](https://supabase.com/docs/guides/database/database-linter).

## Fourteen-Market-Day Production Gate

For each market day after rollout, record:

- Supabase Postgres log occurrences matching `40P01` or `deadlock detected`
  for scanner tables.
- Vercel log occurrences of both scanner deadlock retry event names.
- Universe and deep-scan run counts by `complete` and `failed`.
- Provider-call and write-volume summaries stored on the run rows.

The production acceptance gate passes after 14 consecutive market days with
zero scanner deadlocks. Any matching event resets the consecutive-day counter
and should be correlated to the exact run ID and table before changing retry
or schedule settings.
