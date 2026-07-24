# Production Observability Runbook

Alpha Dog emits versioned, single-line JSON telemetry through the Vercel
runtime log and OpenTelemetry paths. Treat the output as an allowlisted
operational protocol: add dimensions only in the serializer, never at a call
site.

## Correlation and trace lookup

Every `/api` response includes `x-alpha-dog-correlation-id`. A caller value is
accepted only when it is 1–64 ASCII characters, begins with an alphanumeric
character, contains a digit or separator, and otherwise uses only
letters, digits, `.`, `_`, `:`, or `-`. Invalid control, Unicode, whitespace,
or oversized input is replaced with a UUID.

To investigate a failed request:

1. Copy the response header or the safe `error.correlationId` returned for an
   unexpected HTTP 500.
2. Search Vercel Runtime Logs for the exact UUID. The request boundary emits
   one `api.request` record with route template, method, status, outcome,
   duration, and safe error class.
3. Open the matching trace and filter custom attributes by
   `alpha_dog.correlation_id`. Provider child spans use the same trace and
   correlation value.
4. For Workflow retries, search the same `correlationId` and the returned
   `logicalOperationId`. Durable arguments preserve both across resume.

Do not paste request bodies, query strings, user identifiers, provider
responses, prompts, statement rows, symbols, wallets, cookies, or credentials
into logs or incident notes.

## Health endpoints

| Endpoint | Contract | Dependency traffic |
| --- | --- | --- |
| `GET /api/health/live` | HTTP 200 while the process can serve requests | None |
| `GET /api/health/ready` | HTTP 200 when required dependencies pass; otherwise HTTP 503 | Concurrent, read-only, 1.5-second timeout, cached 30 seconds healthy or 10 seconds failed, and coalesced in flight |
| `GET /api/health/configuration` | Aggregate deployment-mode/configuration readiness | None |

The readiness probes cannot place trades, write database rows, start
Workflows, or issue paid OpenAI generations. Output contains only aggregate
required/optional counts, status, and bounded duration. The cache and in-flight
coalescing prevent public fan-out from multiplying provider traffic.

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
- `alert.event`, `alert.deduplicated`, and `alert.delivery_failed`: native
  runtime alert-adapter lifecycle.

All dimensions are bounded and low-cardinality. Final serialization discards
unknown fields recursively and emits only an allowlist. Telemetry and alert
delivery are fail-open for successful business behavior; readiness is
fail-closed for required dependencies.

## Alert definitions

Configure Vercel Runtime Log/Observability monitors from these source-controlled
rules in `src/lib/observability/alerts.ts`:

| Alert | Threshold and window | Minimum samples | Severity | Cooldown / recovery |
| --- | --- | --- | --- | --- |
| stale screener snapshot | age ≥ 30 minutes in 15 minutes | 1 | warning | 15 minutes / 1 healthy sample |
| missing or failed cron refresh | ≥ 1 in 15 minutes | 1 | error | 15 minutes / 1 healthy sample |
| provider error rate | ≥ 10% in 5 minutes | 20 | warning | 5 minutes / 3 healthy samples |
| paid-route denial/unavailable anomaly | ≥ 20% in 15 minutes | 20 | warning | 15 minutes / 3 healthy samples |
| Workflow failure | ≥ 1 in 5 minutes | 1 | error | 5 minutes / 1 healthy sample |
| import finalization failure | ≥ 1 in 5 minutes | 1 | error | 5 minutes / 1 healthy sample |

Use exact JSON fragments as the monitor filter, such as
`"event":"provider.request"` plus a non-success `"outcome"`, or
`"event":"alert.event"` plus the relevant `"alertKey"`. The native adapter
emits controlled cron, Workflow, and import failures into the same searchable
runtime stream. Cooldown suppresses duplicate pages without suppressing the
underlying operational event.

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
npm run benchmark:observability
npm run verify:browser-secrets
```

The suite inventories every API route, tests final serialized redaction with
canaries, injects all five provider failure classes, proves parent/child trace
linkage, exercises real cron/Workflow/import alert events, verifies concurrent
health behavior, and measures route-boundary overhead and body-byte parity.

Implementation follows the official
[Next.js instrumentation convention](https://nextjs.org/docs/app/guides/instrumentation),
[Vercel OpenTelemetry guidance](https://vercel.com/docs/tracing/instrumentation),
and [Supabase production/security guidance](https://supabase.com/docs/guides/deployment/going-into-prod).
Trace propagation to third-party provider URLs is explicitly denied in
`src/instrumentation.ts` and on every provider fetch. Automatic fetch spans are
also suppressed there so configured/custom provider URLs and query values
cannot enter trace attributes. Sanitized custom provider spans remain inside
Alpha Dog’s trace without sending internal trace headers to those providers.
