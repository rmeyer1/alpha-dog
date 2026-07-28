# Tiered deep-scan work

AD-019 replaces strategy-shaped scheduler batches with database-owned work
units keyed by `(symbol, option_type)`. The public screener reader is unchanged:
the tiered workflow republishes scored results into the existing
`wheel_deep_scan_candidates` and `wheel_deep_scan_coverage` tables. AD-020 owns
the later reader cutover to shared market-batch snapshots.

## Default tiers

| Tier | Ranked symbols | Freshness | Work units |
| --- | ---: | ---: | ---: |
| `priority` | 1–250 | 15 minutes | 500 |
| `daily` | 251–1,000 | 24 hours | 1,500 |
| `weekly` | 1,001+ | 7 days | two per eligible symbol |

Each symbol receives one put and one call work unit. Rank is recalculated
server-side from explicit product priority, recent candidate yield, dollar
volume, daily volume, and symbol. A promotion can pull the next due time
forward; demotion does not erase already-due work.

## Claim and completion protocol

1. `sync_wheel_deep_scan_work_queue` activates eligible symbol/type units and
   applies the current tier ranking.
2. `claim_wheel_deep_scan_work` selects at most the configured claim limit with
   `FOR UPDATE SKIP LOCKED`. It returns an owner UUID, opaque lease token, and
   expiration for each unit.
3. One Workflow run loads only the claimed universe rows and claimed stock
   snapshots. Provider steps are built from the exact claimed
   `(symbol, option_type)` set rather than a symbol/type cross-product, so
   complementary owners cannot duplicate each other's provider work.
4. Compatibility publication uses one PostgreSQL transaction that locks,
   revalidates, and extends every token at the mutation boundary before
   atomically deleting/upserting legacy candidates and coverage. A reclaim
   after an earlier heartbeat therefore rejects the entire stale publication
   without changing either legacy table.
5. `complete_wheel_deep_scan_work_batch` validates every owner/token pair and
   publishes all queue outcomes plus fact-batch completion in one PostgreSQL
   transaction. One stale member rejects and rolls back the whole completion.
6. Expired claims are reclaimed. An old owner or token cannot heartbeat,
   publish, complete, or fail replacement work. Exact completion replay is
   idempotent; comparison of the complete normalized result payload rejects any
   replay whose outcome, contract count, error, token, symbol, or option type
   differs.

Provider outages retain the last successful queue freshness timestamp, record
a `provider_outage` outcome, and apply the tier-configured bounded exponential
backoff. The compatibility publisher preserves the legacy behavior of removing
a stale candidate when its current refresh fails. Other failures use a bounded
five-minute-to-one-hour retry. Successful and no-candidate outcomes schedule
the tier freshness interval.

## Scheduling and market calendar

The GitHub trigger runs at minutes `10,25,40,55` across the UTC envelope that
can overlap 8:00 a.m. through the exchange close in New York. The route uses
the versioned US-equities calendar, so weekends, holidays, DST, and early
closes are enforced in application code. `force=true` is the explicit
operator override; `dryRun=true` synchronizes and previews work without taking
leases or starting a Workflow.

Defaults:

- `WHEEL_DEEP_SCAN_CLAIM_LIMIT=625`
- `WHEEL_DEEP_SCAN_CLAIM_LEASE_SECONDS=3600`

The claim limit is capped at 1,000 and the lease at 7,200 seconds.

## Operational metrics

`get_wheel_deep_scan_work_metrics` returns:

- total eligible units, due backlog, active claims, and oldest due age;
- average claim and completion latency;
- global on-time, overdue, failed, and never-scanned counts;
- per-tier freshness target, state counts, and compliance ratio.

Metrics intentionally show overdue work while the market is closed. A
Thanksgiving-week simulation verifies that the scheduler performs no provider
work on the holiday or after Friday's early close and that all default tiers
still receive coverage at the default claim size.

## Verification

- `npm run test:deep-scan-work:coverage`
- `npm run test:supabase:catalog`
- `node scripts/test-tiered-deep-scan-work.mjs`
- `npm run test:supabase`

The Data API verifier launches concurrent claims, proves their sets are
disjoint, reclaims expired work, rejects mutation-time stale publication and
altered completion replay, checks transaction rollback when one batch member
is invalid, verifies provider backoff, and measures 625-unit claim, heartbeat,
and completion RPCs. The domain suite measures exact mixed 625-unit fan-out
and asserts that its output has no cross-product work.
