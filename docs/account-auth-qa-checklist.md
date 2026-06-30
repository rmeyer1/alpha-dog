# Account Auth QA Checklist

Use this checklist for manual provider flows that are difficult to automate locally. Keep API security checks in the backend/security issue track; this checklist is focused on user-facing account and auth behavior.

## Google OAuth

- Signed-out user can start Google sign-in from the auth entry point.
- Provider cancellation returns to Alpha Dog with a visible, non-destructive error state.
- Provider error returns to Alpha Dog with a visible retry path and no stale loading spinner.
- Successful sign-in with a complete profile routes to the intended account-aware destination.
- Successful sign-in with a missing required profile routes to profile completion before account-owned features are available.

## Apple OAuth

- Signed-out user can start Apple sign-in from the auth entry point.
- Provider cancellation returns to Alpha Dog with a visible, non-destructive error state.
- Provider error returns to Alpha Dog with a visible retry path and no stale loading spinner.
- Successful sign-in with a complete profile routes to the intended account-aware destination.
- Successful sign-in with a missing required profile routes to profile completion before account-owned features are available.

## Manual Account

- Required profile fields expose visible labels and validation messages.
- Password and email validation failures do not clear already valid fields.
- Duplicate email attempts show the provider-linking or sign-in guidance expected by the account rules.
- Submit loading disables duplicate submissions and restores controls after server errors.
- Successful account creation establishes a session or routes to the configured verification flow.

## Session And Logout

- Signed-out users cannot see account-owned preset actions as available actions.
- Profile-incomplete users see a completion gate before account-owned preset actions.
- Signed-in users with complete profiles can save, list, load, and delete their own presets.
- Logout clears account-owned UI state, including saved presets and any profile-specific nav affordances.
- Browser back/forward after logout does not reveal stale account-owned controls as active.
