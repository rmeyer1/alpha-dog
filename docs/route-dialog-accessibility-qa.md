# Route And Dialog Accessibility QA

This checklist covers the shared route boundaries and overlay behavior introduced
for issue #155. Run it against both the pull-request preview and the production
deployment before release sign-off.

## Automated Coverage

- `tests/e2e/route-dialog-accessibility.spec.ts` exercises the actual candidate,
  spread, wallet, filing, open-position, position-detail, and close-position
  components.
- The browser suite verifies initial focus, forward and reverse focus trapping,
  Escape dismissal, invoking-control restoration, stacked-overlay isolation,
  background isolation, and page scroll locking.
- The same suite covers mobile, tablet, desktop, CSS 200% zoom, reduced-motion,
  and forced-colors rendering.
- Axe scans cover the primary routes, both intentional not-found states, and all
  shared overlays. Critical and serious findings fail the test.
- `src/components/ui/accessible-overlay.test.ts` covers the shared overlay
  lifecycle in isolation, including nested overlays.
- `src/lib/company-profile.test.ts` covers invalid and provider-confirmed missing
  company symbols.

## Screen Reader Checklist

Test once with VoiceOver and Safari on macOS, and once with NVDA and a supported
Chromium browser on Windows.

### Route Boundaries

- Open `/route-that-does-not-exist`; confirm the "We could not find that page"
  heading, explanation, and navigation actions are announced without a stack
  trace or internal error details.
- Open `/company/INVALID_SYMBOL`; confirm the company-specific not-found heading,
  explanation, and recovery actions are announced.
- While navigating to `/screeners`, `/traders`, `/account`, and
  `/company/BRK.B`, confirm the loading message is announced once and the final
  page has one useful primary heading.
- Trigger a recoverable route error in a local or preview environment; confirm
  the error heading and recovery actions are announced without raw exception
  text.

### Candidate, Spread, Wallet, And Filing Overlays

- Open each overlay from its invoking control. Confirm the dialog name and
  description are announced, then confirm focus lands inside the overlay.
- Tab and Shift+Tab through every control. Confirm focus wraps within the active
  overlay and never enters the page behind it.
- Press Escape. Confirm only the top overlay closes and focus returns to the
  invoking control.
- With the wallet drawer constrained vertically, focus the "Wallet profile
  details" region and confirm it can be scrolled from the keyboard.

### Position Overlays

- Open the add-position dialog from a candidate. Confirm focus lands on Strategy
  and validation errors are announced as alerts without repeating on unrelated
  field changes.
- Save a simulated position. Confirm the success message is announced once as a
  status update.
- Open position detail, then open close position. Confirm the close-position
  dialog is the only active dialog and focus lands on Contracts.
- Close the nested dialog with Escape. Confirm position detail becomes active
  again and focus returns to the Close position button.
- Trigger a stale or invalid close request. Confirm the error is announced as an
  alert; confirm a successful close is announced once as a status update.

## Visual And Input Checklist

- At 320×720, 768×1024, and 1440×900, confirm dialogs remain within the viewport,
  long content scrolls inside the overlay, and the page behind it does not
  scroll.
- At 200% browser zoom, repeat every overlay and confirm no action or message is
  clipped or obscured.
- With reduced motion enabled, confirm loading indicators and transitions do not
  depend on continuous animation.
- With forced colors enabled, confirm dialog boundaries, controls, selected
  states, and focus outlines remain distinguishable.
- Use keyboard-only navigation across candidate cards, spread cards, wallet
  rows, filing rows, open-position controls, and position-detail controls.
  Confirm every interactive element has a visible focus indicator.

## Required Commands

```bash
npm test
npm run lint
npm run typecheck
npm run build
npx playwright test
```
