# Deployment modes

Alpha Dog selects its data posture with `ALPHA_DOG_DEPLOYMENT_MODE`:

- `demo` enables labeled, simulated sample data. The application displays a
  persistent demo banner and never presents these results as live.
- `development` uses configured providers and fails affected routes closed when
  required credentials are missing. This is the default outside production.
- `live` requires the production provider set and reports an invalid readiness
  state until it is complete. This is the default when `NODE_ENV=production`.

`USE_DEMO_DATA` is retired and ignored. Demo behavior must always be selected
explicitly.

## Live provider checklist

Configure these variables for a healthy live deployment:

- Alpaca market data: `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`
- Server persistence: `ALPHA_DOG_SUPABASE_URL`,
  `ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY`
- Browser authentication: `NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL` and either
  `NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY` or
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Trade analysis: `OPENAI_API_KEY`
- Earnings, when enabled: `FINNHUB_API_KEY`

`GET /api/health/configuration` returns the active mode and provider readiness
without secret values. Invalid live configuration returns HTTP 503. Market-data
routes also return an actionable HTTP 503 before reading a cache or invoking a
provider, so an invalid live deployment cannot silently serve demo data.

Apply the Supabase migrations before enabling the release. The provenance
migration stores the candidate source mode, feed, cache status/source, and
timestamp on simulated positions, and adds the source mode to materialized
screener snapshot identity.
