# Wheel Screener Refresh

The wheel screener serves materialized Supabase snapshots first, then starts
workflow refreshes when data is missing, stale, or explicitly forced.

## Market-Hours Fan-Out

`WHEEL_SCREENER_REFRESH_MAX_RUNS` controls how many due screener refresh
workflows a market-hours cron request can start. The default is `4`, matching
the four configured strategy refreshes:

- `short_put`
- `put_credit_spread`
- `covered_call`
- `call_credit_spread`

This keeps each strategy within the configured freshness window without waiting
for four separate scheduled triggers.

## Freshness Window

`WHEEL_SCREENER_REFRESH_MIN_AGE_MINUTES` defaults to `15`. Completed
materialized snapshots younger than this are treated as recent; older snapshots
are due on the next eligible cron request.

## Off-Hours Behavior

The cron route uses the shared versioned US equities calendar and skips outside
the current core session unless the request is explicitly forced. Holidays and
exceptional closures never report as sessions, and early-close days stop at
1:00 p.m. New York time.

The GitHub schedule is bounded to UTC hours that can overlap either the guarded
session or prewarm window. Invocations run at minutes `7`, `22`, `37`, and
`52` instead of clock-quarter boundaries to avoid contention with market-data
publication and the deep-scan trigger. The route-level calendar remains
authoritative across daylight-saving changes.

Weekend prewarm is controlled separately by
`WHEEL_SCREENER_WEEKEND_REFRESH_MAX_RUNS`, which also defaults to `4`. It is
eligible only from 4:00–6:00 p.m. New York time on the final closed day before
the next session. A normal Sunday can prewarm Monday, while Sunday before a
Monday exchange holiday is skipped and the holiday Monday becomes the final
prewarm opportunity.

Calendar ownership, coverage, authoritative sources, and the annual update
procedure are documented in
[`market-calendar-operations.md`](./market-calendar-operations.md).

## Health Summary

`GET /api/cron/wheel/screener-refresh` returns a `health` object with the
configured strategy count, due/recent/running counts, max snapshot age, and a
per-strategy decision summary. Use this before changing cadence or freshness
thresholds so cron tuning stays tied to live snapshot data.

Trigger responses report enqueue acceptance separately from publication
completion. `enqueueSucceeded: true` means Vercel accepted the Workflow run;
`publicationCompleted: false` remains accurate until the durable Workflow
finishes and the materialized snapshot row becomes `complete`.

## Follow-Up Tuning

Tune deep-scan coverage separately from top-level screener freshness. The
landing-page freshness issue is primarily controlled by materialized screener
fan-out and the 15-minute freshness window.
