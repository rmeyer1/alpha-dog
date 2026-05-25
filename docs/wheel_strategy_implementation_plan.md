# Wheel Strategy Dashboard — Engineering Implementation Plan

**Goal:** Build a REST-first MVP from the BRD using React/Next.js, Node.js, TypeScript, Alpaca REST APIs, and a cache-aware request layer.

---

## Phase 0 — Project Setup

Deliverables:

- Next.js TypeScript app.
- Strict TypeScript config.
- Tailwind + component library.
- Environment variable schema.
- Basic app shell.
- Server-only Alpaca client module placeholder.

Acceptance criteria:

- App boots locally.
- TypeScript strict mode enabled.
- Alpaca keys are read only server-side.
- No market data calls from browser.

---

## Phase 1 — Alpaca REST Client

Deliverables:

- Server-side client for:
  - option chain snapshots
  - option snapshots by symbols
  - option contracts metadata
  - stock bars
  - latest stock quote/latest bar
- Pagination handling.
- Feed config: `opra` / `indicative`.
- Retry/backoff policy.
- Safe error mapping.

Acceptance criteria:

- Can fetch option chain for one ticker using REST.
- Can fetch stock bars for MA/RSI calculations.
- 401/403/429/5xx are mapped to internal error codes.
- Secrets never appear in logs or responses.

---

## Phase 2 — Domain Normalization and Calculations

Deliverables:

- Normalized contract metadata type.
- Normalized option snapshot type.
- Underlying technical context type.
- Calculation functions:
  - midpoint
  - spread
  - spread % of mid
  - DTE
  - premium yield
  - annualized yield
  - breakeven
  - called-away price
  - MA20/50/200
  - RSI-14
  - trend classification

Acceptance criteria:

- Calculations are deterministic and unit tested.
- Invalid contracts are excluded with clear reasons.
- Daily bars produce technical context for the response.

---

## Phase 3 — Persona Scoring Engine

Deliverables:

- Persona config definitions:
  - Conservative Wheel
  - Balanced Wheel
  - Aggressive Yield
  - Weekly Theta
  - High IV Hunter
  - Custom-ready schema
- Score component functions.
- Persona-specific weighting.
- Warning generator.

Acceptance criteria:

- Same contract can receive different scores by persona.
- High premium cannot override poor liquidity/risk in Balanced default.
- Warning objects are produced independently of score.
- Score breakdown exists internally.

---

## Phase 4 — Cache and Request Layer

Deliverables:

- Cache key builder.
- TTL config by data type.
- Stale-while-revalidate response behavior.
- Manual refresh support.
- 429 fallback to stale cache where available.

Acceptance criteria:

- Repeated identical requests avoid unnecessary Alpaca calls.
- Response includes `cacheStatus`, `asOf`, and feed.
- Stale cache can be served with clear UI metadata.
- Force refresh respects provider rate limits.

---

## Phase 5 — Internal REST APIs

Deliverables:

- `POST /api/wheel/analyze`
- `GET /api/wheel/personas`
- `GET /api/presets`
- `POST /api/presets`
- `PUT /api/presets/{id}`
- `DELETE /api/presets/{id}`
- Optional `POST /api/wheel/refresh-contracts`

Acceptance criteria:

- Analyze endpoint returns ranked short puts and covered calls.
- Preset CRUD works.
- Validation errors are useful.
- Alpaca errors are safe and user-readable.

---

## Phase 6 — Frontend Dashboard

Deliverables:

- Ticker search.
- Persona selector.
- Saved preset controls.
- Underlying summary card.
- Short Puts tab.
- Covered Calls tab.
- Ranked contract table.
- Warning badges.
- Data freshness UI.
- Empty/error states.

Acceptance criteria:

- User can complete the core BRD workflow.
- User can compare rankings across personas.
- Warnings are visible without opening row details.
- UI handles loading, stale, and provider error states.

---

## Phase 7 — QA and Hardening

Deliverables:

- Unit tests for calculations and scoring.
- Integration tests for internal API contracts with mocked Alpaca responses.
- UI tests for search/persona/table flow.
- Error-state tests for rate limit and missing data.
- Accessibility pass for core dashboard controls.

Acceptance criteria:

- Scoring tests cover conservative/balanced/aggressive differences.
- API tests verify no secret leakage.
- UI tests verify warnings render.
- Empty states are tested.

---

## MVP Milestone Definition

MVP is complete when:

1. User enters a ticker.
2. App fetches Alpaca REST market data server-side.
3. App returns ranked short puts and covered calls.
4. App shows premium yield, annualized yield, delta, theta, DTE, strike, bid/ask, liquidity, and score.
5. App shows earnings, IV, liquidity, trend, and upside-cap warnings when applicable or unknown.
6. User can switch Conservative/Balanced/Aggressive and see rankings change.
7. User can save and reuse filter presets.
8. No WebSocket is required.
9. No trade execution exists.

---

## Key Open Questions for Rob

1. Confirm whether Alpaca account has OPRA options data access.
2. Choose MVP earnings data source or allow `earningsStatus: unknown` for first internal build.
3. Decide whether saved presets need login in MVP or can be local/private initially.
4. Confirm whether docs should be pushed directly to `github.com/rmeyer1/alpha-dog` via PR.
