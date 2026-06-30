# Session Route Guards QA

Issue: #56

## Scope

Session refresh middleware keeps Supabase browser sessions fresh across reloads.
Account-owned APIs continue to enforce server-side Supabase session and profile
checks. OAuth callback/start routes and cron routes remain outside middleware
blocking behavior.

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

### Logout

1. Sign in and confirm `GET /api/presets` returns HTTP `200`.
2. Call `POST /api/auth/logout`.
3. Confirm the response is:

```json
{
  "status": "signed_out"
}
```

4. Reload the app or call `GET /api/presets` again.
5. Confirm the user is unauthenticated and account-owned APIs return
   `UNAUTHENTICATED`.

### Route Exclusions

Confirm middleware does not block:

- `GET /auth/callback`
- `GET /api/auth/oauth/google`
- `GET /api/auth/oauth/apple`
- `/api/cron/*` routes that already use `CRON_SECRET`

## Automated Coverage

- `src/lib/supabase/account-session.test.ts`
- `src/lib/supabase/session-middleware.test.ts`
- `src/lib/supabase/logout.test.ts`
