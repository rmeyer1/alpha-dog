# Manual Account QA

Issue #54 implements the server-side contract for manual account creation.
Issue #62 adds the account-page form for that contract.

## Account Page Form

- Visit `/account`.
- Confirm the sign-in actions include Google, deferred Apple, and a manual
  account path.
- Confirm the manual account form includes labeled first name, last name, and
  email fields with `autocomplete` attributes.
- Submit empty fields and confirm inline field errors render without sending a
  request.
- Submit an invalid email and confirm the email field shows an inline error.
- Confirm the submit button is disabled while the request is in flight.

## Valid Create

- Submit the account page form with `email`, `firstName`, and `lastName`.
- Confirm the response is `201` with `status: invite_sent`.
- Confirm the UI shows an invite-sent success state for the requested email.
- Confirm Supabase Auth has one user for the email.
- Confirm `account_profiles` has one row keyed by that auth user ID.
- Confirm `primary_provider` is `email`.
- Confirm the invite redirect returns to `/account?profile=complete` with the
  preserved safe `next` value.

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
- Confirm the form routes to
  `/account?auth_error=EMAIL_ALREADY_REGISTERED&next=...` and renders the
  account conflict UX.
- Confirm no second Supabase Auth user is created.

## Retry After Partial Failure

- If profile creation fails after Supabase Auth invite creation, the API attempts to delete the newly created auth user before returning `ACCOUNT_PROFILE_CREATE_FAILED`.
- Retry the same request after resolving the underlying database problem.
- Confirm the retry can create exactly one auth user and exactly one profile row.

## Safety

- Responses must not expose service-role keys, provider tokens, stack traces, or raw Supabase internals.
- Password auth is not part of this endpoint; it starts a Supabase invite/passwordless flow.
