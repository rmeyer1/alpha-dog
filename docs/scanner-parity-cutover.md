# Scanner parity and controlled cutover

AD-020 moves scheduled screener refreshes onto the shared market-batch
workflow without changing the default public reader. One normalized persisted
fact batch feeds both the legacy-compatible snapshot and the replacement
snapshot, so parity measurement does not repeat paid provider calls.
Each consumer loads the persisted facts once, computes the two independent
projections once, and stages both before replacement publication begins.

## Safety contract

- `wheel_scanner_rollout_control.read_source` defaults to `legacy`.
- The replacement reader accepts only a current pointer whose batch and
  snapshot are both complete.
- If replacement storage has no complete readable pointer or its read throws,
  the server immediately falls back to the legacy reader and emits bounded
  failure telemetry.
- Control and parity tables use forced RLS, have no client policies, and grant
  access only to `service_role`.
- Diagnostic samples contain at most ten candidate identities, mismatch
  classes, and field names. They never contain credentials, raw provider
  payloads, prompts, or user financial data.
- Financial, eligibility, score-component, and warning differences are
  blocking. Rank-only differences are classified separately and still require
  review.

## Rollout stages

1. Keep `read_source = 'legacy'`. Run scheduled batches and collect parity
   observations from all configured persona/strategy consumers.
2. Exercise replacement selection and fallback in a non-production
   environment, including an interrupted batch whose current pointer must
   remain unchanged.
3. Observe at least 14 consecutive US-equities market days with acceptable
   parity, freshness, AD-017 claim safety, and AD-018 batch reliability.
4. Switch reads through the service-role RPC:

   ```sql
   select public.set_wheel_scanner_read_source('replacement');
   ```

5. Keep legacy-compatible publication and storage throughout the observation
   period. Removing it requires a later reviewed change after the 14-market-day
   evidence gate.

## Immediate rollback

Rollback does not require a deployment, schema rollback, or data restoration:

```sql
select public.set_wheel_scanner_read_source('legacy');
```

The next request resolves the server-side control row and reads the legacy
snapshot. If control-plane lookup itself fails, application code also fails
safe to legacy. The legacy snapshot is populated from the independent legacy
projection, not from the replacement response.

## Observation query

```sql
select public.get_wheel_scanner_parity_metrics(current_date - 30);
```

The result includes distinct observed market days, exact-match ratio, and
separate eligibility, financial, score, warning, and ordering mismatch totals.
Deployment/run/batch IDs should be retained alongside release evidence.
