# Manual Account QA

Issue #54 implements the server-side contract for manual account creation. UI wiring is intentionally left for the design/frontend card.

## Valid Create

- Submit `POST /api/auth/manual-account` with `email`, `firstName`, and `lastName`.
- Confirm the response is `201` with `status: invite_sent`.
- Confirm Supabase Auth has one user for the email.
- Confirm `account_profiles` has one row keyed by that auth user ID.
- Confirm `primary_provider` is `email`.

## Missing Required Fields

- Omit `firstName`, `lastName`, or `email`.
- Confirm the response is `400` with `error.code = INVALID_MANUAL_ACCOUNT`.
- Confirm no Supabase Auth user or `account_profiles` row is created.

## Invalid Email

- Submit an invalid email string.
- Confirm the response is `400` with `error.code = INVALID_MANUAL_ACCOUNT`.
- Confirm no Supabase Auth user or `account_profiles` row is created.

## Duplicate Email

- Submit an email whose normalized form already exists in `account_profiles`.
- Confirm the response is `409` with `error.code = EMAIL_ALREADY_REGISTERED`.
- Confirm no second Supabase Auth user is created.

## Retry After Partial Failure

- If profile creation fails after Supabase Auth invite creation, the API attempts to delete the newly created auth user before returning `ACCOUNT_PROFILE_CREATE_FAILED`.
- Retry the same request after resolving the underlying database problem.
- Confirm the retry can create exactly one auth user and exactly one profile row.

## Safety

- Responses must not expose service-role keys, provider tokens, stack traces, or raw Supabase internals.
- Password auth is not part of this endpoint; it starts a Supabase invite/passwordless flow.
