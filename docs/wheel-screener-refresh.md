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

The cron route skips outside US market hours unless the request is explicitly
forced. This avoids spending option-data calls on overnight data that can look
fresh while the market is closed.

Weekend prewarm is controlled separately by
`WHEEL_SCREENER_WEEKEND_REFRESH_MAX_RUNS`, which also defaults to `4`.

## Health Summary

`GET /api/cron/wheel/screener-refresh` returns a `health` object with the
configured strategy count, due/recent/running counts, max snapshot age, and a
per-strategy decision summary. Use this before changing cadence or freshness
thresholds so cron tuning stays tied to live snapshot data.

## Follow-Up Tuning

Tune deep-scan coverage separately from top-level screener freshness. The
landing-page freshness issue is primarily controlled by materialized screener
fan-out and the 15-minute freshness window.
