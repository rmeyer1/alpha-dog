# OAuth Auth QA

Use this checklist for the OAuth foundation and account sign-in UX.

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

## Missing Email

- Simulate or inspect a provider callback where Supabase user email is absent.
- Confirm the callback redirects with `auth_error=missing_email`.
- Confirm no profile row is created.

## Duplicate Email

- Sign in with an OAuth provider whose normalized email already belongs to another profile.
- Confirm the callback redirects with `auth_error=ACCOUNT_EMAIL_CONFLICT`.
- Confirm the unique `normalized_email` constraint prevents a duplicate profile.

## Cancelled OAuth

- Start Google OAuth and cancel at the provider screen.
- Confirm the callback redirects with `auth_error=oauth_cancelled`.
- Confirm `/account?auth_error=oauth_cancelled` shows a recoverable sign-in
  cancelled state with retry and dashboard actions.
- Confirm the URL does not expose provider tokens or raw Supabase error details.
