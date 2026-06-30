# Auth Hardening Runbook

Issue: #57

## Security Checklist

- Supabase RLS is enabled for account-owned tables:
  - `account_profiles`
  - `account_identities`
  - `saved_presets`
  - `analysis_requests`
- Owner policies use `auth.uid()` and are hardened in
  `20260630022000_harden_account_auth_policies.sql`.
- Supabase service-role credentials are read only by server-side helpers and
  must never use `NEXT_PUBLIC_*` names.
- OAuth provider access tokens must not be logged or returned in API payloads.
- Account/auth failure logs use the event name
  `alpha_dog_auth_account_failure` with a correlation ID and stable code only.

## Correlation IDs

Auth/account failures include a correlation ID in safe API error responses or
server logs. To trace a reported issue, search logs for:

```text
alpha_dog_auth_account_failure correlationId=<reported-id>
```

If a request includes `x-alpha-dog-correlation-id`, the server reuses it.
Otherwise the server generates a UUID.

## Common Failures

### Provider Misconfiguration

Symptoms:

- OAuth start redirects to `/account?auth_error=oauth_start_failed`.
- Supabase dashboard shows missing/invalid provider client credentials.

Checks:

- Confirm Google provider is enabled in Supabase Auth.
- Confirm provider client ID and secret are present in Supabase, not Vercel.
- Confirm the app has `NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL` and
  `NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY`.

### Redirect URL Mismatch

Symptoms:

- OAuth callback returns `/account?auth_error=oauth_callback_failed`.
- Provider dashboard shows redirect URI mismatch.

Checks:

- Confirm the provider allows the deployed callback origin.
- Confirm Supabase Auth URL configuration includes the deployed site URL.
- Confirm callbacks route through `/auth/callback`.

### Duplicate Email

Symptoms:

- OAuth returns `ACCOUNT_EMAIL_CONFLICT`.
- Manual account creation returns `EMAIL_ALREADY_REGISTERED`.

Checks:

- Search `account_profiles.normalized_email` for the normalized address.
- Do not manually create duplicate profiles. The DB unique constraint is the
  source of truth and handles race conditions.
- Apple private relay addresses are distinct emails unless a future explicit
  linking flow proves ownership.

### Missing Profile Fields

Symptoms:

- OAuth redirects to `/account?profile=complete`.
- Account-required APIs return `PROFILE_INCOMPLETE`.

Checks:

- Confirm `account_profiles.email`, `first_name`, and `last_name` are present.
- Apple may not return name data after the first authorization, so profile
  completion is expected for missing Apple name fields.

### RLS Denial

Symptoms:

- Account-owned data reads return empty results for records that exist.
- Preset updates/deletes return `PRESET_FORBIDDEN` or `PRESET_NOT_FOUND`.

Checks:

- Confirm the request has a valid Supabase user session.
- Confirm `saved_presets.user_id` or `analysis_requests.user_id` equals
  `auth.uid()`.
- Confirm no route is trying to trust client-supplied `user_id`.

## Verification Commands

```bash
npm test
npm run lint
npm run build
```

Relevant automated coverage:

- `src/lib/supabase/auth-observability.test.ts`
- `src/lib/supabase/manual-account.test.ts`
- `src/lib/supabase/oauth.test.ts`
- `src/lib/supabase/rls-policy.test.ts`
- `src/lib/supabase/account-session.test.ts`
