# Session Route Guards QA

Issue: #150

## Scope

The Next.js proxy refreshes Supabase browser sessions only for account pages,
account-owned APIs, and the account-state/profile/logout routes. A cheap
Supabase-cookie gate skips the Auth client entirely when no browser session is
present. Account-owned APIs continue to enforce authoritative server-side
Supabase session and profile checks; proxy state is never the authorization
boundary.

## Manual QA Matrix

### Unauthenticated Access

1. Clear Supabase auth cookies or use a private browser session.
2. Call `GET /api/presets`.
3. Confirm HTTP `401` with:

```json
{
  "error": {
    "code": "UNAUTHENTICATED"
  }
}
```

### Expired Session

1. Use an expired/invalid Supabase session cookie.
2. Call `GET /api/presets`.
3. Confirm HTTP `401` with `UNAUTHENTICATED`.

### Incomplete Profile

1. Sign in as a user whose `account_profiles` row is missing `first_name`,
   `last_name`, or `email`.
2. Call `GET /api/presets`.
3. Confirm HTTP `403` with `PROFILE_INCOMPLETE`.

### Completed Profile

1. Sign in as a user whose `account_profiles` row includes `email`,
   `first_name`, and `last_name`.
2. Call `GET /api/presets`.
3. Confirm HTTP `200` and a `{ "presets": [] }` or populated presets response.

### Account Navigation State

1. Clear Supabase auth cookies or use a private browser session.
2. Call `GET /api/auth/account-state`.
3. Confirm HTTP `200` with `account.status = unauthenticated`.
4. Sign in with an incomplete profile and confirm
   `account.status = incomplete_profile`.
5. Complete the profile and confirm `account.status = ready` with displayable
   account identity fields only.

### Logout

1. Sign in and confirm `GET /api/presets` returns HTTP `200`.
2. Confirm the app header exposes a sign-out control.
3. Call `POST /api/auth/logout` or use the header control.
4. Confirm the response is:

```json
{
  "status": "signed_out"
}
```

5. Reload the app or call `GET /api/presets` again.
6. Confirm the user is unauthenticated and account-owned APIs return
   `UNAUTHENTICATED`.
7. Confirm dashboard preset state clears instead of showing stale
   account-owned presets.

### Route Exclusions

Confirm the proxy does not match public data or provider routes:

- `GET /api/logos/AAPL`
- `GET /api/wheel/screener`
- `GET /api/finnhub/company/AAPL`
- `GET /api/polymarket/leaderboard`

Confirm self-authenticating routes remain outside the proxy:

- `GET /auth/callback`
- `GET /api/auth/oauth/google`
- `GET /api/auth/oauth/apple`
- `/api/cron/*` routes that already use `CRON_SECRET`

### Session Refresh Call Budget

The pre-AD-010 root middleware matched every non-static public page and API
request, so each request entered session-refresh logic and could invoke
`supabase.auth.getUser()`. The AD-010 proxy matcher reduces that entry set to
the account surface. Within that surface, requests without a non-empty
`sb-<project-ref>-auth-token` cookie (including chunked `.0`, `.1`, and later
numeric cookies) perform zero Supabase client initializations and zero Auth
calls. Look-alike suffixes such as `.backup`, `.01`, or `.1.extra` do not enter
the refresh path.

The automated matcher and call-count tests are the regression measurement:

- public market-data/logo request: `getUser()` count changes from up to 1 to 0;
- account request without a session cookie: `getUser()` count changes from up
  to 1 to 0;
- account request with a session cookie: exactly 1 refresh call;
- protected route handlers still call `getUser()` authoritatively and do not
  trust the proxy as access control.

Run `npm run benchmark:session-proxy` for the deterministic four-route
instrumentation (`/`, `/screeners`, `/traders`, and `/api/logos/AAPL`). The
2026-07-23 baseline processed 8,000 requests: the legacy path made 8,000 Auth
calls versus 0 for the scoped proxy. Local pass-through median/p95 were
0.00165/0.03671 ms versus 0.00167/0.01292 ms for the legacy harness, within
the declared 0.05 ms local-noise tolerance. The benchmark deliberately
excludes network time; removing the Auth call is the provider-traffic and
production-latency improvement.

When refresh rotates or deletes a cookie, the response must preserve
`Set-Cookie` together with Supabase SSR's `Cache-Control`, `Expires`, and
`Pragma` cache-safety headers. Protected JSON responses copy all four from the
intermediate auth response so a CDN cannot cache one user's refreshed token.

Proxy refresh failure is routing-fail-open by design. Account Server
Components and protected Route Handlers still validate with `getUser()` and
profile checks, so a missing, expired, revoked, cross-project, or crafted
`x-middleware-subrequest` request remains unauthenticated at the authoritative
layer.

## Automated Coverage

- `src/lib/supabase/account-session.test.ts`
- `src/lib/supabase/account-nav.test.ts`
- `src/lib/supabase/session-middleware.test.ts`
- `src/proxy.test.ts`
- `src/lib/supabase/logout.test.ts`
