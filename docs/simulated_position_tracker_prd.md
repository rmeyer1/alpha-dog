# Simulated Premium-Selling Position Tracker PRD

## Purpose

Alpha-Dog can find premium-selling candidates, but users cannot yet save a
paper trade, track open and closed lifecycle events, or understand simulated
account-level profit and loss over time.

This PRD defines the MVP for an authenticated simulated position tracker for
sell-side option strategies. It is intentionally simulation-only: no broker
linking, order routing, tax reporting, or portfolio optimization.

## Goals

- Let authenticated users save simulated positions from wheel screener rows,
  spread rows, and single-ticker analysis results.
- Support single-leg and multi-leg premium-selling strategies from day one.
- Track open, partial-close, full-close, expiration, assignment, and manual
  review states.
- Display account-level simulated cash, margin, premium collected, realized
  P/L, unrealized P/L, and margin interest separately.
- Preserve a data model that can later support `source = broker` without
  replacing simulated position records.

## Non-Goals

- Real brokerage account linking.
- Real order placement or execution.
- Tax reporting.
- Complex broker-specific buying power, margin approval, or liquidation rules.
- Automated close recommendations or portfolio optimization.

## Primary Workflows

### Save A Simulated Position

1. User views a candidate from `/screeners` or a ticker result.
2. User clicks an add-position action.
3. A compact modal opens with strategy, legs, strikes, expiration, and premium
   details prefilled where available.
4. User confirms contracts count, open credit, open date, and optional notes.
5. App saves the position to the authenticated account.

### Review Paper Account

1. User opens `/account`.
2. App shows simulated account summary:
   - cash balance
   - margin balance
   - margin interest rate
   - total premium collected
   - realized option P/L
   - unrealized option P/L
   - margin interest accrued
3. User can inspect open and closed positions.

### Close A Position

1. User opens a position detail or close action.
2. User enters closed contracts and close debit/credit.
3. App records a close event.
4. Remaining contracts stay open when the close is partial.
5. Realized P/L updates only for the closed quantity.

### Expiration And Assignment

1. App detects expired positions where market data is sufficient.
2. OTM short options can be marked expired worthless.
3. ITM short puts create simulated equity lots at the strike price.
4. If assignment requires more cash than available, the deficit becomes margin.
5. Ambiguous outcomes enter a manual review state.

## Product Rules

- Options multiplier defaults to `100`.
- Premium received = `openCredit * contracts * 100`.
- Buyback cost = `closePrice * closedContracts * 100`.
- Realized P/L for closed quantity = allocated premium received minus buyback
  cost.
- Unrealized P/L uses current option midpoint or mark when available.
- Margin interest is visible separately from option trade P/L.
- Default annual margin interest rate is `5%`.
- Simulated starting cash can be zero or user-entered.
- All position records are account-owned and protected by RLS.

## Data Model Requirements

Implementation starts in issue #88. The model should include:

- `paper_accounts` for per-user settings, starting cash, current cash, margin,
  and margin interest rate.
- `simulated_positions` for account-owned strategy records, source, status,
  lifecycle timestamps, notes, and aggregate quantities.
- `simulated_position_legs` for option/equity leg details, including side,
  quantity, expiration, strike, option type, open price, and latest mark.
- `simulated_position_events` for open, close, partial close, expiration,
  assignment, cash adjustment, margin interest, and manual adjustment events.
- `simulated_equity_lots` for assigned shares created by option lifecycle
  events.

The schema should be append-friendly: realized P/L and cash/margin state should
be reconstructable from events even if summary columns are cached for speed.

## API Requirements

Implementation starts in issues #89-#93.

- Create simulated positions from screener and ticker candidates.
- List positions for the authenticated account.
- Fetch a position detail with legs and events.
- Close part or all of a position.
- Return a paper-account summary suitable for `/account`.
- Reject unauthenticated requests.
- Reject requests for positions owned by another account.
- Return actionable validation errors for invalid quantities, prices, and close
  requests.

## P/L And Accounting Requirements

Implementation starts in issue #90.

- Track realized option P/L by closed quantity.
- Track unrealized option P/L from current marks where available.
- Track total premium collected separately from realized P/L.
- Track cash changes from opens, closes, assignments, and adjustments.
- Track margin balance separately from cash.
- Track margin interest separately from option trade P/L.
- Keep accounting deterministic and unit tested.

## Frontend Requirements

Implementation starts in issues #95-#102.

- Add plus actions to candidate and spread result rows.
- Add a compact add-position modal with prefilled leg snapshots.
- Support single-leg and spread entry from the first UI slice.
- Add paper account summary and basic settings to `/account`.
- Add account positions list and position detail UI.
- Add partial-close modal and remaining-position states.
- Add expiration, assignment, and manual review UI states.
- Add accessibility and responsive coverage for the new flows.

## Rollout Plan

1. Data model and RLS: issue #88.
2. Create-position API: issue #89.
3. P/L and account calculations: issue #90.
4. Close APIs: issue #91.
5. Expiration, assignment, equity lots, and margin handling: issue #92.
6. List/detail/account-summary APIs: issue #93.
7. Backend QA: issue #94.
8. Frontend entry actions and modal: issues #95-#97.
9. Account summary, list/detail, close, expiration, and QA UI: issues #98-#102.

## Acceptance Criteria

- Authenticated users can save simulated premium-selling trades.
- Positions support single-leg and multi-leg strategies.
- Partial closes preserve remaining open contracts.
- Account summary separates premium, realized option P/L, unrealized option P/L,
  cash, margin, and margin interest.
- Assignment can create simulated shares and margin deficit when cash is
  insufficient.
- All account-owned records are protected by RLS.
- APIs and UI include tests for ownership, accounting, and lifecycle edge cases.

## Open Decisions

- Whether starting cash is required during first position creation or can remain
  zero until edited on `/account`.
- Whether MVP valuation should use option midpoint only, or fall back through
  last trade and model mark when midpoint is unavailable.
- Whether margin interest accrues daily automatically or only when account
  summary is recalculated.
