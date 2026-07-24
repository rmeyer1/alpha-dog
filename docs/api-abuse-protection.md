# Paid and privileged API route protection

AD-003 protects origin work, rather than charging users for responses already
served from an application or CDN cache. Limits are enforced by the
`acquire_api_abuse_budget` Supabase RPC, so counters and concurrency leases are
shared across application instances. If that RPC or its service-role
configuration is unavailable, protected work fails closed with
`ABUSE_PROTECTION_UNAVAILABLE`.

## Route classification and budgets

| Route or operation | Classification | Window budget | Concurrency | Timeout |
| --- | --- | --- | --- | --- |
| `POST /api/trade/analyze` | Authenticated only | 8/user/minute, 16/IP/minute | 2 | 45s |
| `POST /api/wheel/analyze` live cache miss | Authenticated only; cache/demo responses are public | 10/user/5m, 20/IP/5m | 2 | 30s |
| Live start from `POST /api/wheel/screener` | Authenticated only after cache/fallback miss | 4/user/15m, 8/IP/15m | 2 | 20s |
| Start from `POST /api/wheel/screener/runs` | Authenticated only after cache/fallback miss | 4/user/15m, 8/IP/15m | 2 | 20s |
| `GET /api/wheel/screener/runs/[runId]` and `/stream` setup | Authenticated only | 120/user/5m, 240/IP/5m | 20 | 15s setup |
| Polymarket cache hit | Public cacheable | No paid quota consumed | N/A | N/A |
| Polymarket cache miss | Anonymous with quota | 60/user/5m, 30/IP/5m | 6 | 15s |
| Polymarket `forceRefresh=true` | Authenticated only | 6/user/5m, 12/IP/5m | 4 | 15s |
| Finnhub company routes | Anonymous with quota | 60/user/5m, 30/IP/5m | 8 | 10s |
| `GET /api/logos/[symbol]` origin cache miss | Public cacheable | 240/user/5m, 120/IP/5m | 12 | 5s |
| `GET /api/alpaca/feed-test` | Internal only; hidden in production, authenticated outside production | 10/user and IP/5m | 2 | 10s |
| `POST /api/auth/manual-account` | Anonymous with Turnstile | 5/IP/hour, 2/normalized email/day | 4 | 5s challenge |
| `GET/POST /api/cron/*` | Internal cron | Existing `CRON_SECRET`; excluded from user/IP quotas | Existing workflow bounds | Route-specific |

The Polymarket routes covered by the two Polymarket rows are leaderboard,
whales, sharp plays, and trader wallet profile. Finnhub coverage includes the
aggregate company route plus profile, metrics, earnings, news, and
recommendations.

## Responses and telemetry

- Rate and concurrency denials return HTTP `429`, a `Retry-After` header, and
  stable codes `API_RATE_LIMITED` or `API_CONCURRENCY_LIMITED`.
- Manual-account denials return the same HTTP `202` response as an eligible
  request so callers cannot use throttling to discover whether an address is
  registered. Its IP and normalized-email values are stored only as HMACs.
- Limiter failures return HTTP `503` with
  `ABUSE_PROTECTION_UNAVAILABLE`; provider failures do not expose upstream
  payloads, credentials, or provider error details.
- Metrics are minute aggregates containing only route key, outcome,
  authenticated/anonymous classification, count, and timestamps. Request
  bodies, symbols, financial inputs, and provider payloads are not recorded.
- IPs are stored only as a server-side HMAC. Set a 32+ character
  `API_ABUSE_HMAC_SECRET`; when omitted, the Supabase service-role key is used
  as the HMAC secret.

Apply `20260720224500_create_api_abuse_protection.sql` before deploying the
paid-route changes and
`20260723182159_harden_manual_account_invitations.sql` before deploying manual
account hardening. Old rate windows, expired leases, and old usage aggregates
can be deleted by a maintenance job after the desired observability retention
period.
