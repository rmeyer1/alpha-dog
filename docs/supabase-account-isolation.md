# Supabase Account Isolation

This runbook defines the clean-database security contract for Alpha Dog's
account-owned data. The repository migrations are the source of truth: a fresh
local project must reproduce the same table privileges, row-level security
(RLS), lifecycle RPC permissions, and ownership constraints without relying on
Supabase project defaults.

## Account-owned tables

The isolation suite covers all 14 account-owned tables:

| Table | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| `account_profiles` | none | own-row CRUD | CRUD |
| `account_identities` | none | own-row CRUD | CRUD |
| `saved_presets` | none | own-row CRUD | CRUD |
| `analysis_requests` | none | own-row CRUD | CRUD |
| `paper_accounts` | none | own-row CRUD | CRUD |
| `simulated_positions` | none | own-row CRUD | CRUD |
| `simulated_position_legs` | none | own-row CRUD | CRUD |
| `simulated_position_events` | none | own-row CRUD | CRUD |
| `simulated_equity_lots` | none | own-row CRUD | CRUD |
| `statement_imports` | none | own-row CRUD | CRUD |
| `statement_import_rows` | none | own-row CRUD | CRUD |
| `statement_reconciliation_groups` | none | own-row CRUD | CRUD |
| `statement_reconciliation_group_rows` | none | own-row CRUD | CRUD |
| `statement_import_review_audit` | none | own-row select/insert | CRUD |

`authenticated` cannot use `TRUNCATE`, `REFERENCES`, or `TRIGGER` on these
tables. `statement_import_review_audit` is append-only for account users.
Its ownership policies additionally require the referenced import and
reconciliation group to belong to the same user and to each other.

Child-table policies validate the complete ownership graph. A matching
top-level `user_id` is not sufficient when a leg, event, lot, import row, or
reconciliation link points at a parent owned by another account.

## Lifecycle RPCs

Only `authenticated` may execute these functions:

- `open_simulated_position_atomic(jsonb)`
- `close_simulated_position_atomic(uuid,numeric,integer,timestamptz,text)`
- `expire_simulated_position_atomic(uuid,numeric,timestamptz,text)`
- `finalize_statement_import_atomic(uuid,jsonb,jsonb,jsonb)`

Execution is revoked from `PUBLIC`, `anon`, and `service_role`. All four
functions use invoker security and an empty `search_path`, so their
schema-qualified SQL executes under the caller's RLS constraints. The
behavioral suite proves owner success, anonymous and cross-owner denial,
owner-column spoof denial, and rollback without partial writes.

## Local verification

Docker must be running. Install the pinned toolchain and start the disposable
local stack:

```bash
npm ci
npm run supabase:start:test
npm run test:supabase
```

`test:supabase` resets the database solely from committed migrations, runs 262
pgTAP/catalog assertions, exercises Data API isolation with two real
authenticated users and an anonymous client, runs the `service_role` checks in
a separate server-only process, evaluates local advisors, and lints the public
schema.

Stop the disposable project when finished:

```bash
npx supabase stop --no-backup
```

The CI `Supabase isolation` job performs the same start, reset, verification,
and cleanup flow.

## Browser secret containment

Run:

```bash
npm run verify:browser-secrets
```

The verifier builds production with unique sentinel values for every supported
server credential, including service-role keys, market/provider API
credentials, the abuse-protection HMAC secret, Turnstile secret, and cron
secret. It scans browser chunks, source maps when present, manifests,
client-reference manifests, and rendered static assets. Neither sentinel
values nor server-only credential variable names may appear in
browser-consumable output. Service-role behavioral tests remain in a separate
Node process and never import client application modules.

## Advisors and deployment

Before merging a migration:

1. Run the complete local isolation suite and both local advisor categories.
2. Apply the exact reviewed migration to the Alpha Dog Supabase project.
3. Re-run remote catalog checks, the two-user Data API matrix, lifecycle RPC
   checks, and remote security/performance advisors.
4. Record each remaining advisor finding by rule, object, risk, and rationale.

The AD-009 migration adds the three foreign-key indexes identified by the
performance advisor:

- `simulated_position_events.paper_account_id`
- `statement_import_review_audit.group_id`
- `statement_import_review_audit.user_id`

RLS-without-policy notices on intentionally service-only internal tables and
unused-index notices are informational and must be reviewed rather than
automatically removed. The existing leaked-password-protection warning is an
Auth project setting, not a database migration; it remains an owner/admin
configuration follow-up and is not silently waived by this runbook.

## References

- [Supabase local development and CLI workflows](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase database testing](https://supabase.com/docs/guides/local-development/testing/overview)
- [Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase table exposure opt-in change](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
