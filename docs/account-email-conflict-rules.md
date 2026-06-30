# Account Email Conflict Rules

Issue #53 defines the MVP duplicate-email rules for Google OAuth and future manual account creation. Apple is post-MVP, so Apple private relay behavior is documented as future-provider behavior rather than a launch requirement.

## Boundary

`account_profiles.normalized_email` is the account-level uniqueness boundary. The database unique constraint remains the final protection against concurrent duplicate-account creation.

Normalization is intentionally simple:

- trim leading/trailing whitespace
- lowercase the email address
- do not remove Gmail dots
- do not rewrite plus-addressing
- do not treat Apple private relay addresses as aliases for real emails

## Error Codes

- `EMAIL_ALREADY_REGISTERED`: manual account creation attempted with an email whose normalized form already exists.
- `ACCOUNT_EMAIL_CONFLICT`: OAuth returned an email whose normalized form already belongs to another account and the provider identity is not already linked to the authenticated user.

These codes are safe for UI routing and should not include provider tokens, raw Supabase errors, or internal database details.

## Provider Linking

Provider linking is allowed only when the request is already authenticated as the account owner or another explicit proof step is implemented later. The app must not link providers solely because two provider emails match.

For OAuth callbacks:

- A new Google OAuth user with an unused email can create one profile.
- A repeat Google OAuth sign-in for the same Supabase user records or preserves the linked provider identity.
- If the normalized email is already owned by another profile, the callback returns `ACCOUNT_EMAIL_CONFLICT`.
- Future providers, including Apple, follow the same rule unless Supabase guarantees the identity belongs to the same authenticated user.

## Scenario Coverage

- New Google user with unused email: create account profile and linked Google identity.
- Existing Google user signs in again: do not create a duplicate profile; preserve linked identity.
- Manual account exists, Google returns the same normalized email: return `ACCOUNT_EMAIL_CONFLICT` unless an explicit linking flow proves ownership.
- Google account exists, manual account creation uses the same email: return `EMAIL_ALREADY_REGISTERED`.
- Future Apple private relay email: treat as a distinct email string unless explicitly linked by an authenticated user.
- Future provider same-email collision: use `ACCOUNT_EMAIL_CONFLICT` unless explicit linking is completed.
