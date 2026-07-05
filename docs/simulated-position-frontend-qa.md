# Simulated Position Tracker Frontend QA

## Automated Coverage

- Add-position payload coverage lives in `src/components/wheel-dashboard/add-position-modal.test.ts`.
- Add-position auth/profile action coverage lives in `src/components/wheel-dashboard/add-position-modal.test.ts`.
- Partial-close validation and stale refresh prompt coverage lives in `src/components/account/paper-positions-panel.test.ts`.
- Lifecycle label coverage for expired OTM, assigned, and manual-review states lives in `src/components/account/paper-positions-panel.test.ts`.
- Backend accounting, RLS, assignment, and lifecycle calculations stay covered by backend tests from issue #94 and related account tests.

## Manual QA Checklist

Run the app locally with seeded or mocked account data that includes open, partially closed, closed, assigned, expired OTM, and manual-review positions.

### Add Position

- Desktop candidate table: Tab to the open-position icon button, activate with Enter, and confirm the add-position modal opens with a descriptive dialog label.
- Mobile candidate card: activate the Open position button and confirm it does not also open the candidate detail drawer.
- Press Escape and overlay-close from the add-position modal; focus should return to the invoking open-position action.
- Submit invalid contracts or price; validation feedback should be visible and announced through the inline feedback region.
- Submit while unauthenticated or profile-incomplete; the inline action should clearly say Sign in or Complete profile.

### Account Summary And Positions

- `/account` with no simulated positions should show the empty position state without horizontal page overflow at mobile width.
- Open and history tabs should remain keyboard reachable and should not shift layout when counts change.
- Desktop positions table should keep long symbols/statuses readable without overlapping adjacent columns.
- Mobile cards should wrap long symbols, notes, and lifecycle labels without clipping.
- Refresh buttons should have accessible names distinct from other repeated actions.

### Position Detail

- Open a position detail from desktop and mobile layouts; the detail drawer should present `aria-modal` and a descriptive accessible label.
- Keyboard users should be able to reach Close position, drawer close, and all focusable controls in visual order.
- Empty, loading, and API error states should render inline with retry or close actions that have visible labels.
- Saved leg snapshots should distinguish missing values from zero values.

### Partial Close

- Open the close-position modal from an open position; focus should land on Contracts.
- Enter zero, decimal, above-remaining, negative price, and blank close-date values; each should show the expected inline validation message.
- Above-remaining errors should offer a Refresh action because the local position may be stale.
- Successful partial close should refresh remaining quantity, account summary, and event history without requiring a page reload.
- Successful full close should move the position out of the open list and into history.

### Lifecycle States

- Expired OTM, Assigned, Called away, and Manual review labels must be text-visible, not color-only.
- Assigned detail should show effective date, shares, cost basis, assignment cost, cash impact, margin used, and underlying at expiration when provided.
- Expired OTM detail should show effective date, contracts expired, premium retained, and underlying at expiration when provided.
- Manual review detail should make clear the position was not automatically resolved.
- Missing optional lifecycle metadata should show `Unavailable` or fallback copy rather than breaking the drawer.

## Required Commands

```bash
npm test
npm run lint
npm run build
```
