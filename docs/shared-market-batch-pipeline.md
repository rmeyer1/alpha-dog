# Shared market-batch pipeline

AD-018 introduces a durable replacement pipeline for wheel-market ingestion
and scoring. It does not change the production reader. AD-020 owns comparison,
cutover, rollback, and removal of the legacy scanner path.

AD-019 reuses these fact tables for tiered deep-scan claims but does not
publish or advance the shared snapshot pointer. Claimed-symbol coverage
batches may retain per-symbol provider failures so the queue can apply bounded
backoff independently; the original all-required-option-type publication rule
below remains unchanged for reader-visible snapshot batches.

## Ownership

| Layer | Responsibility |
| --- | --- |
| `src/workflows/wheel-market-batch/` | Durable orchestration and fan-out using small identifiers |
| `src/lib/wheel/market-batch/service.ts` | Provider ingestion, scoring, and lifecycle transitions |
| `src/lib/wheel/market-batch/domain.ts` | Shared discovery filters and pure scoring from persisted facts |
| `src/lib/wheel/market-batch/repository.ts` | Service-role persistence and lifecycle RPC calls |
| `src/lib/wheel/market-batch/reader.ts` | Dormant current-pointer reader for AD-020 parity and cutover work |
| `supabase/migrations/20260727201158_create_shared_market_batch_pipeline.sql` | Batch schema, least-privilege grants, and atomic lifecycle functions |

The workflow function carries a batch ID, request configuration, counters, and
snapshot IDs. Provider payloads are normalized and persisted inside step
functions; they are not serialized through the workflow.

## Lifecycle

1. `create_wheel_market_batch` takes an interval and options feed. An
   advisory transaction lock plus the interval/feed unique constraint returns
   one canonical batch to concurrent callers. Only the caller that created the
   canonical identity performs ingestion; competing workflow attempts return
   the canonical batch identity without entering provider steps.
2. The underlying step refreshes the asset universe, stock snapshots,
   technical context, and cached earnings once. A durable completion
   checkpoint makes later workflow replays read the persisted facts.
3. Option steps fan out by selected symbol and option type. Each step performs
   one full discovery and records a `(batch, symbol, option type)` completion
   checkpoint. A provider failure is recorded as partial coverage; database
   persistence failures remain retryable and are not mislabeled as provider
   failures.
4. Scoring consumers read the same persisted fact rows. Persona filters and
   strategy formulas remain in the existing scoring domain.
5. Each consumer stages a snapshot header and ranked candidate rows.
   `publish_wheel_market_batch_snapshot` validates the candidate count, marks
   the header complete, but does not make it readable.
6. `complete_wheel_market_batch` validates every expected snapshot and every
   required option type, marks the batch complete, and advances all eligible
   current pointers in one transaction.

Incomplete or failed batches are never referenced by a current pointer. A
failure after one or more consumer snapshots stage therefore leaves every
previous pointer unchanged. Snapshot staging, batch completion, and failure
functions are replay-safe.

## Storage

- `wheel_market_batches`: canonical interval/feed identity and lifecycle.
- `wheel_market_batch_underlyings`: one normalized underlying fact row per
  batch and symbol.
- `wheel_market_batch_option_contracts`: normalized option facts independent
  of persona and strategy.
- `wheel_market_batch_option_ingestions`: durable symbol/type checkpoints.
- `wheel_market_batch_snapshots`: per-consumer headers and completion markers.
- `wheel_market_batch_candidates`: ranked, serialized route-compatible rows.
- `wheel_market_batch_current_snapshots`: atomic reader pointer per consumer.
- `wheel_market_batch_metrics`: provider requests, database rows, and duration
  by ingestion, scoring, and publication operation.

All eight tables are service-role only, use forced RLS, and have explicit
privileges. They are not readable with anonymous or authenticated client
credentials.

## Idempotency and failure behavior

- Creating the same interval/feed batch returns the existing identity.
- Completed underlying and option checkpoints short-circuit replayed steps.
- Fact and candidate upserts use deterministic conflict keys.
- Snapshot creation returns the existing per-batch consumer header.
- Re-staging a complete snapshot returns its identity without changing any
  current pointer.
- A late older interval may complete for auditability, but interval ordering
  prevents it from replacing a newer current pointer.
- Candidate-count mismatches, incomplete consumers, and a required option type
  with zero successful symbol ingestion fail before atomic publication.
- Retention removes only old complete or failed batches that are not referenced
  by a current pointer.

External provider calls and database writes are not one atomic transaction.
A process failure between those boundaries can repeat only the affected
durable step; deterministic upserts keep the stored result idempotent.

## Metrics and rollout boundary

Each completed batch stores provider request count, affected database-row
count, and elapsed milliseconds for asset, stock, technical, earnings, put,
call, scoring, and publication operations. This supports before/after
production comparison without inferring costs from logs.

AD-019 will claim and schedule tiered work. AD-020 will run legacy and
replacement parity telemetry, select the read path, expose rollback controls,
and verify the one-refresh-per-interval production invariant. Until that
controlled cutover, public wheel routes continue to use the released reader.

## Verification

Run the complete local database gate:

```bash
npm run test:supabase
```

The gate reconstructs every migration, runs pgTAP catalog and lifecycle tests,
checks anonymous/two-user Data API isolation, races two batch creations,
proves atomic publication and failure retention, runs database advisors, and
lints the public schema.
