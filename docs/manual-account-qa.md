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
- Complete the Turnstile challenge and confirm it resets after a rejected
  server response.
- Confirm the submit button is disabled while the request is in flight.

## Valid Create

- Submit the account page form with `email`, `firstName`, and `lastName`.
- Confirm the response is `202` with `status: accepted` and no account ID or
  registration-state detail.
- Confirm the UI shows the generic accepted state.
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
- Confirm the status, body shape, and user-visible copy exactly match a new
  eligible request.
- Confirm no second Supabase Auth user is created.

## Rate Limits and Bot Verification

- Submit more than five requests from one IP within one hour and confirm later
  requests return the generic `202` response without sending invitations.
- Submit more than two requests for one normalized email within one day and
  confirm the same privacy-preserving response.
- Confirm neither raw IP addresses nor email addresses appear in limiter rows
  or logs.
- Submit missing, invalid, expired, replayed, and wrong-action Turnstile tokens.
- Confirm each fails before a Supabase Auth invitation is attempted.
- Make Turnstile verification unavailable and confirm the route fails closed
  with `MANUAL_ACCOUNT_UNAVAILABLE`.

## Redirect and Atomicity

- Submit an off-origin or protocol-relative `nextPath` and confirm the invite
  uses the configured Alpha Dog origin and `/account` fallback.
- Confirm no caller-supplied absolute redirect reaches Supabase Auth.
- Force the profile trigger to fail and confirm the auth-user insert rolls back
  before an invitation is considered successful.
- Confirm no application path deletes an auth user after an email is sent.

## Safety

- Responses must not expose service-role keys, provider tokens, stack traces, or raw Supabase internals.
- Production requires `ALPHA_DOG_APP_URL` (or Vercel's trusted deployment URL),
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, and `TURNSTILE_SECRET_KEY`.
- Password auth is not part of this endpoint; it starts a Supabase invite/passwordless flow.
