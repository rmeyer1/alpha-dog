# OAuth Auth QA

Use this checklist for the OAuth foundation and account sign-in UX.

## Automated Frontend Coverage

- `tests/e2e/auth-flows.spec.ts` runs Playwright coverage for:
  - signed-out account page auth actions and manual account form labels
  - unauthenticated presets panel gating
  - signed-in dashboard account navigation and logout clearing saved presets
  - incomplete-profile account navigation state
- The Playwright suite mocks account-state, preset, logout, and screener API
  responses so it does not require live Supabase users or provider credentials.

## Google Success

- Visit `/api/auth/oauth/google?next=/screeners`.
- Complete Google sign-in with an account that returns verified email plus given/family name fields.
- Confirm the browser returns to `/screeners`.
- Confirm Supabase has exactly one `account_profiles` row for the user ID.
- Confirm the row has `email`, generated `normalized_email`, `first_name`, `last_name`, and `primary_provider = google`.

## Account Sign-In Entry

- Visit `/account`.
- Confirm the page shows an accessible Google sign-in action.
- Confirm the Google link preserves a safe `next` destination when supplied,
  such as `/account?next=/screeners`.
- Confirm the manual account path focuses the manual account form and preserves
  the same safe `next` value for invite redirects.
- Confirm Apple sign-in is shown as deferred and is not an enabled provider
  launch action for MVP.

## Profile Completion

- Sign in with an account that has no complete `account_profiles` row.
- Confirm `/account?profile=complete&next=/screeners` shows the profile
  completion form instead of the generic account hub.
- Confirm the provider/session email is displayed as immutable identity data.
- Submit empty first and last names and confirm inline validation appears.
- Submit valid first and last names and confirm `PATCH /api/auth/profile`
  returns `status = complete`.
- Confirm the app routes back to the intended `next` destination or refreshes
  the account hub when `next=/account`.

## Future Apple Support

- Apple login is post-MVP. Do not configure, require, or test Apple as a launch
  provider.
- Future Apple private relay email addresses should display as returned by the
  backend/account policy and should not be inferred as equivalent to another
  email without an explicit linking flow.
- When Apple or another future provider is enabled, repeat the duplicate-email
  and provider-link prompt scenarios with private relay and direct provider
  emails. Confirm the UI treats both as backend-provided email strings only.

## Manual Provider Matrix

- Google new account, complete provider profile: returns to the requested
  `next` route and shows complete account state.
- Google new account, missing first or last name: routes to
  `/account?profile=complete&next=...` and shows the profile completion form.
- Google cancellation: routes to `/account?auth_error=oauth_cancelled&next=...`
  and shows recoverable retry/dashboard actions.
- Google duplicate normalized email: routes to
  `/account?auth_error=ACCOUNT_EMAIL_CONFLICT&next=...` and shows the account
  conflict state.
- Manual account duplicate normalized email: routes to
  `/account?auth_error=EMAIL_ALREADY_REGISTERED&next=...` and shows the manual
  duplicate conflict state.
- Future provider private relay/direct email: keep disabled for MVP, then test
  only after provider support is explicitly enabled.

## Missing Email

- Simulate or inspect a provider callback where Supabase user email is absent.
- Confirm the callback redirects with `auth_error=missing_email`.
- Confirm no profile row is created.

## Duplicate Email

- Sign in with an OAuth provider whose normalized email already belongs to another profile.
- Confirm the callback redirects with `auth_error=ACCOUNT_EMAIL_CONFLICT`.
- Confirm `/account?auth_error=ACCOUNT_EMAIL_CONFLICT&next=/screeners`
  renders the account conflict state instead of the generic sign-in failure.
- Confirm the conflict state offers safe actions back to the account hub and
  dashboard without implying that the client can merge accounts.
- Confirm a future manual account form can use
  `/account?auth_error=EMAIL_ALREADY_REGISTERED` to render the manual duplicate
  email state.
- Confirm the unique `normalized_email` constraint prevents a duplicate
  profile.

## Provider Link Prompt

- While signed in, visit
  `/account?provider_link=required&provider=google&provider_email=desk@example.com&next=/screeners`.
- Confirm the account page renders a provider-link confirmation panel with
  confirm and cancel actions.
- Confirm the provider email is displayed exactly as supplied by the backend.
- Confirm the confirm and cancel controls are keyboard reachable and have
  screen-reader labels.
- Confirm unavailable backend linking returns a plain recoverable error instead
  of exposing stack traces or provider internals.

## Cancelled OAuth

- Start Google OAuth and cancel at the provider screen.
- Confirm the callback redirects with `auth_error=oauth_cancelled`.
- Confirm `/account?auth_error=oauth_cancelled` shows a recoverable sign-in
  cancelled state with retry and dashboard actions.
- Confirm the URL does not expose provider tokens or raw Supabase error details.
