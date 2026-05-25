# Alpha-Dog Wheel Strategy Documentation

This documentation package translates the Wheel Strategy Dashboard BRD into implementation-ready technical guidance.

## Document Set

- [`wheel_strategy_prd.md`](./wheel_strategy_prd.md) — Product requirements from the previous planning pass.
- [`wheel_strategy_tech_spec.md`](./wheel_strategy_tech_spec.md) — REST-first architecture, Alpaca integration, cache strategy, and system components.
- [`wheel_strategy_api_spec.md`](./wheel_strategy_api_spec.md) — Internal REST API contracts for analysis, personas, saved presets, and refresh behavior.
- [`wheel_strategy_data_model.md`](./wheel_strategy_data_model.md) — PostgreSQL-ready data model, cache/audit entities, and domain DTOs.
- [`wheel_strategy_algorithms.md`](./wheel_strategy_algorithms.md) — Calculation, scoring, liquidity, warning, and persona-ranking specification.
- [`wheel_strategy_frontend_ux_spec.md`](./wheel_strategy_frontend_ux_spec.md) — React/Next.js dashboard UX, table, warning, accessibility, and state behavior.
- [`wheel_strategy_implementation_plan.md`](./wheel_strategy_implementation_plan.md) — Engineering build phases and acceptance criteria.

## MVP Architecture Decision

The MVP should use **React + Next.js + Node.js + TypeScript** with Alpaca REST APIs, a server-side cache/request layer, and no WebSocket dependency.

Core principle:

> Rank income only after risk, liquidity, technical context, and assignment quality are considered.

## Open Decisions

1. Confirm whether the Alpaca account has OPRA options data access or should default to the indicative feed.
2. Select an earnings calendar provider or allow `earningsStatus: unknown` for the first internal build.
3. Decide whether saved presets require auth in MVP or can be private/local initially.
4. Decide whether to persist normalized market snapshots or only cache them ephemerally.
