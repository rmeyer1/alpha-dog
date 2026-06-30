# OAuth Auth QA

Use this checklist for the issue #52 OAuth foundation. It intentionally avoids final visual styling expectations.

## Google Success

- Visit `/api/auth/oauth/google?next=/screeners`.
- Complete Google sign-in with an account that returns verified email plus given/family name fields.
- Confirm the browser returns to `/screeners`.
- Confirm Supabase has exactly one `account_profiles` row for the user ID.
- Confirm the row has `email`, generated `normalized_email`, `first_name`, `last_name`, and `primary_provider = google`.

## Apple Success

- Visit `/api/auth/oauth/apple?next=/account`.
- Complete Apple sign-in with an account that returns email and name on first authorization.
- Confirm the browser returns to `/account`.
- Confirm Supabase has exactly one `account_profiles` row for the user ID.
- Confirm private relay email addresses are accepted as the account email when Apple returns one.

## Missing Apple Name

- Sign in with Apple in a scenario where Apple returns email but no first or last name.
- Confirm the callback returns to `/account?profile=complete`.
- Confirm no duplicate `account_profiles` row is created.
- Confirm account-owned features remain gated until profile completion is implemented.

## Missing Email

- Simulate or inspect a provider callback where Supabase user email is absent.
- Confirm the callback redirects with `auth_error=missing_email`.
- Confirm no profile row is created.

## Duplicate Email

- Sign in with an OAuth provider whose normalized email already belongs to another profile.
- Confirm the callback redirects with `auth_error=duplicate_email`.
- Confirm the unique `normalized_email` constraint prevents a duplicate profile.

## Cancelled OAuth

- Start Google or Apple OAuth and cancel at the provider screen.
- Confirm the callback redirects with `auth_error=oauth_cancelled`.
- Confirm the URL does not expose provider tokens or raw Supabase error details.
