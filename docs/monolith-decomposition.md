# Application module boundaries

AD-016 decomposes the application’s high-risk implementation files without
changing their public entry points, route contracts, or financial formulas.
The entry modules below are compatibility facades and the only supported
orchestration imports for callers.

The boundaries are responsibility-based, not line-count rules. New work should
go into the owning module instead of growing a facade merely to satisfy or
avoid a numeric threshold.

| Subsystem           | Orchestration facade                               | Focused ownership                                                                                                                                                                                                                                                                                                  |
| ------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Universe scanner    | `src/lib/wheel/universe-scanner.ts`                | `model.ts` owns contracts, `domain.ts` owns pure ranking/technicals/coverage selection, `candidate-domain.ts` owns pure option selection and normalization, `repository.ts` owns Supabase persistence/run state, and `market-service.ts` owns provider refresh composition.                                        |
| Alpaca market data  | `src/lib/alpaca/client.ts` → `live-market.ts`      | `transport.ts` owns authenticated requests, timeout, rate limiting, and retries; `types.ts` owns provider wire shapes; `normalization.ts` owns provider-free parsing, indicators, and contract normalization. `live-market.ts` composes the public asset, stock, option, cached-market, and feed-probe operations. |
| Simulated positions | `src/lib/account/simulated-positions.ts`           | `contracts.ts` owns Zod/API contracts, `domain.ts` owns pure ledger and expiration calculations, `repository.ts` owns Supabase/RPC mechanics, and `lifecycle.ts` owns pure close transitions. The facade coordinates atomic lifecycle writes and preserves all exported commands.                                  |
| Paper positions     | `src/components/account/paper-positions-panel.tsx` | `contracts.ts` owns serialized API/view types, `formatting.ts` owns display conversion, `reconciliation.ts` owns pagination/event merging, `close-validation.ts` owns pure form validation, `request-state.ts` owns explicit async transitions, and `presentation.tsx` owns shared status presentation.            |
| Trader intelligence | `src/components/trader-intelligence.tsx`           | `domain.ts` owns pure display/filter helpers, `request-state.ts` owns async state transitions, `filter-controls.tsx` owns filtering controls, and `list-presentation.tsx` owns the shared responsive list shell.                                                                                                   |
| Wheel dashboard     | `src/components/wheel-dashboard.tsx`               | `dashboard-request-state.ts` owns result/request transitions, `request-payloads.ts` owns API guards and payload mapping, `screener-status-strip.tsx` owns status presentation, and the existing `wheel-dashboard/` components own filters, results, overlays, and market/preset presentation.                      |
| Filing intelligence | `src/app/company/[ticker]/filing-intelligence.tsx` | `normalization.ts` owns provider/framework-free citation and insight parsing, `presentation.tsx` owns cards/lists/source rendering, and `review-modal.tsx` owns the accessible overlay.                                                                                                                            |

## Dependency rules

- Components in a `"use client"` graph may import serialized types, pure
  browser-safe domain modules, and presentation modules. They must not import
  Alpaca transport, scanner persistence/orchestration, or simulated-position
  server commands as runtime values.
- Provider credentials, service-role persistence, retries, caches, and
  orchestration stay under their server facade and service/repository modules.
- Routes and workflows import only the public facade. Internal modules are not
  cross-subsystem APIs.
- Pure domain and normalization modules must remain testable without network,
  Supabase, React, or Next.js mocks.
- AD-017 through AD-020 own scanner production topology, batching, claim
  semantics, parity rollout, and cutover. AD-016 does not change that topology.

## Compatibility and review rules

- Preserve the current facade exports when moving implementation.
- Characterize payloads, ordering, financial totals, and state transitions
  before changing a boundary.
- Treat formula, route, schema, retry, and lifecycle changes as separate product
  work rather than hiding them in structural refactors.
- Review changes by domain boundary. A future extraction should normally touch
  one facade plus its owned directory, with contract changes called out
  explicitly.
