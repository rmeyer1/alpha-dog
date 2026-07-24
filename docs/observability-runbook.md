# Production Observability Runbook

Alpha Dog emits versioned, single-line JSON telemetry through the Vercel
runtime log and OpenTelemetry paths. Treat the output as an allowlisted
operational protocol: add dimensions only in the serializer, never at a call
site.

## Correlation and trace lookup

Every `/api` response includes a server-generated,
`x-alpha-dog-correlation-id` UUID that is unique to that request. A caller
value never replaces this identity. A valid caller value is retained only as
the secondary `clientCorrelationId`; it must be 1–64 ASCII characters, begin
with an alphanumeric character, contain a digit or separator, and otherwise
use only letters, digits, `.`, `_`, `:`, or `-`. Control, Unicode, whitespace,
and oversized values are discarded.

To investigate a failed request:

1. Copy the response header or the safe `error.correlationId` returned for an
   unexpected HTTP 500.
2. Search Vercel Runtime Logs for the exact UUID. The request boundary emits
   one `api.request` record with route template, method, status, outcome,
   duration, and safe error class.
3. Open the matching trace and filter custom attributes by
   `alpha_dog.correlation_id`. Provider child spans use the same trace and
   correlation value.
4. For Workflow retries, search the same `correlationId` and
   `logicalOperationId`. Durable arguments preserve both plus
   `startedAtEpochMs`, so resumed/completed/failed records report total
   duration. A `started` event is emitted only after Workflow accepts the
   enqueue; rejected enqueues emit `failed` without an orphan start.

Do not paste request bodies, query strings, user identifiers, provider
responses, prompts, statement rows, symbols, wallets, cookies, or credentials
into logs or incident notes.

## Health endpoints

| Endpoint | Contract | Dependency traffic |
| --- | --- | --- |
| `GET /api/health/live` | HTTP 200 while the process can serve requests | None |
| `GET /api/health/ready` | Public, CDN-cached aggregate from the shared Supabase control plane; HTTP 200 when fresh/ready, otherwise HTTP 503 | One aggregate database read on an edge-cache miss; never probes third parties |
| `GET /api/health/ready/refresh` | `CRON_SECRET`-authenticated refresh scheduled every minute by `vercel.json` | At most one cross-instance lease holder runs concurrent, read-only, 1.5-second probes |
| `GET /api/health/configuration` | Aggregate deployment-mode/configuration readiness | None |

The readiness probes cannot place trades, write database rows, start
Workflows, or issue paid OpenAI generations. Output contains only aggregate
required/optional counts, status, and bounded duration. A database lease and
shared 30-second healthy/10-second failed snapshot prevent cold instances,
regions, and scale-out from multiplying provider traffic. Public traffic can
only read the shared aggregate.

During an outage, keep liveness HTTP 200. A required dependency failure should
change readiness to HTTP 503. Recover only after a fresh readiness response is
HTTP 200 and the corresponding provider telemetry is successful.

## Telemetry inventory

- `api.request`: one terminal event per instrumented route call.
- `provider.request`: one terminal event per logical Alpaca, Finnhub,
  Polymarket, OpenAI, or Supabase call. Outcomes are `success`, `http_error`,
  `timeout`, `malformed_response`, or `network_error`.
- `cache.operation`: `fresh_hit`, `stale_fallback`, `miss`, `bypass`,
  `write_success`, or `write_failure`.
- `workflow.lifecycle`: `started`, `resumed`, `completed`, or `failed` for
  wheel screener and deep scan.
- `statement_import.lifecycle`: `started`, `finalized`, or `failed`.
- `paid_route.guard`: allowed, auth/access denial, rate/concurrency denial,
  unavailable limiter, or release failure.
- `cron.execution`: completed or failed.
- `alert.event` and `alert.delivery_failed`: durable alert-adapter lifecycle.
  Trigger/recovery events are persisted in
  `observability_alert_events` and published through the native
  `alpha_dog_observability_alerts` Postgres notification channel.

All dimensions are bounded and low-cardinality. Final serialization discards
unknown fields recursively and emits only an allowlist. Telemetry and alert
delivery are fail-open for successful business behavior; readiness is
fail-closed for required dependencies.

## Alert definitions

The migration
`supabase/migrations/20260724111354_add_observability_control_plane.sql`
installs these rules in the shared database and schedules the evaluator every
minute with Supabase Cron/`pg_cron`. The TypeScript rule definitions are kept
in source-controlled parity:

| Alert | Threshold and window | Minimum samples | Severity | Cooldown / recovery |
| --- | --- | --- | --- | --- |
| stale screener snapshot | age ≥ 30 minutes in 15 minutes | 1 | warning | 15 minutes / 1 healthy sample |
| missing readiness cron heartbeat or observed wheel-cron failure | no readiness refresh heartbeat for 15 minutes, or ≥ 1 failed invocation in 15 minutes | 1 | error | 15 minutes / 1 healthy heartbeat or invocation |
| provider error rate | ≥ 10% in 5 minutes | 20 | warning | 5 minutes / 3 healthy samples |
| paid-route denial/unavailable anomaly | ≥ 20% in 15 minutes | 20 | warning | 15 minutes / 3 healthy samples |
| Workflow failure | ≥ 1 in 5 minutes | 1 | error | 5 minutes / 1 healthy sample |
| import finalization failure | ≥ 1 in 5 minutes | 1 | error | 5 minutes / 1 healthy sample |

Provider, paid-route, wheel-cron, Workflow, and import samples are persisted
with Vercel background work, so business responses and durable work do not
wait on the alert control plane. The every-minute protected readiness refresh
also updates the shared `observability_readiness_state.updated_at` heartbeat.
The database evaluator treats that durable heartbeat as missing after 15
minutes even when no application invocation produced a sample. It atomically
applies thresholds, minimum samples, cooldown, dedup, and recovery, inserts a
durable event, and publishes a native Postgres notification. Inspect
`observability_alert_state` for active conditions and
`observability_alert_events` for the delivery history; both contain only
bounded operational dimensions.

## Incident procedure

1. Confirm `/api/health/live`, then `/api/health/ready`.
2. Search the alert key and correlation ID; confirm whether the failure is
   route, provider, cache, Workflow, import, or rate-limit related.
3. Contain the affected route or scheduled trigger without disabling global
   telemetry.
4. Verify credentials and provider status outside application logs. Never log
   the values.
5. Recover with a controlled request, confirm a success event and readiness
   HTTP 200, then emit or observe the rule’s recovery condition.
6. Check for `alert.delivery_failed`; adapter failure never changes the
   original application response.

## Verification

Run:

```bash
npm test
npm run test:observability:coverage
npm run benchmark:observability
npm run verify:browser-secrets
npm run test:supabase
```

The suite inventories every API route, tests final serialized redaction with
canaries, injects all five failure classes through each real Alpaca, Finnhub,
Polymarket, OpenAI, and Supabase client, proves parent/child trace linkage,
exercises durable cron/Workflow/import trigger, deduplication, and recovery
events, verifies distributed readiness lease and cron-heartbeat absence
behavior, enforces at least 80% statements, branches, functions, and lines for
every observability source file, and checks route-boundary overhead/body-byte
parity.

Implementation follows the official
[Next.js instrumentation convention](https://nextjs.org/docs/app/guides/instrumentation),
[Vercel OpenTelemetry guidance](https://vercel.com/docs/tracing/instrumentation),
and [Supabase production/security guidance](https://supabase.com/docs/guides/deployment/going-into-prod).
Trace propagation to third-party provider URLs is explicitly denied in
`src/instrumentation.ts` and on every provider fetch. Automatic fetch spans are
also suppressed there so configured/custom provider URLs and query values
cannot enter trace attributes. Sanitized custom provider spans remain inside
Alpha Dog’s trace without sending internal trace headers to those providers.
