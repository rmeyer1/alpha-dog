# Account Data Lifecycle

This runbook defines Alpha Dog's account export, deletion, and retention
contract. The schema source of truth is
[`20260727121438_add_account_data_lifecycle.sql`](../supabase/migrations/20260727121438_add_account_data_lifecycle.sql).

## User-facing controls

Every page links to the Privacy notice, Terms of use, and support path through
the root legal footer. A completed account exposes two additional controls:

- `GET /api/account/export` downloads a private, non-cacheable JSON document.
- `POST /api/account/deletion` performs confirmation-heavy permanent deletion.

The export is versioned as `alpha-dog-account-export` schema version `1`. Its
database RPC accepts no user identifier and derives ownership from
`auth.uid()`. It includes the profile, linked identities, presets,
analysis-request history, paper account, positions, legs, events, equity lots,
statement imports and normalized rows, reconciliation groups and memberships,
and immutable review audit.

## Deletion sequence

Deletion requires:

1. an authoritative Supabase user session;
2. a verified JWT whose most recent non-refresh, non-anonymous `amr`
   authentication timestamp is no more than ten minutes old and whose subject
   matches the authoritative user;
3. the signed-in account email;
4. the exact phrase `DELETE MY ACCOUNT`;
5. an explicit irreversibility acknowledgement; and
6. a same-origin request.

The server records only hashes of the retry token, confirmed email, and user
identifier. The authorization transaction first creates or rotates one durable
deletion tombstone. Database triggers then reject inserts and updates across
all 14 account-owned tables, including profile and identity recreation, even
if a revoked access JWT remains cryptographically valid. It then resumes these
durable stages:

1. revoke refresh-token sessions globally;
2. delete linked application identities and the profile-owned cascade;
3. hard-delete the Supabase Auth user; and
4. remove the retry token and direct user identifier from the completed audit.

An opaque HttpOnly, `SameSite=Strict`, path-scoped cookie permits a failed
request to resume for 24 hours without keeping the user's ordinary session
active. Repeating an already-completed application-data deletion returns zero
deleted rows instead of failing. Auth retries treat only Supabase's specific
`session_not_found`, `refresh_token_not_found`, and `user_not_found` codes as
already-completed stages; status-only authorization, validation, and
administrative failures remain failures. Incomplete deletion tombstones remain
until Auth deletion completes; only completed pseudonymous audits enter the
90-day cleanup window.

Supabase documents two boundaries that shape this sequence:

- [sign-out revokes refresh tokens while access JWTs remain valid until
  expiry](https://supabase.com/docs/guides/auth/signout);
- [Auth user deletion is an administrative operation and does not itself sign
  the user out](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser).
- [Auth error responses expose stable codes for programmatic
  handling](https://supabase.com/docs/guides/auth/debugging/error-codes).

The application-data cascade removes the deleted user's authorization and
records before Auth removal, so a previously issued short-lived JWT has no
account-owned rows to access.

## Retention policy

The daily `alpha-dog-account-data-retention` cron runs at 03:15 UTC:

| Category | Retention |
| --- | ---: |
| Failed or unfinished statement imports | 30 days |
| Raw financial fields for completed imports | 90 days |
| Completed import, reconciliation, and review metadata | 365 days |
| Provider-derived analysis-request history | 90 days |
| Completed pseudonymous deletion audits | 90 days |
| Retention-run history | 90 days |

At 90 days, raw JSON, dates, instrument text, description, transaction code,
quantity, price, amount, confidence, and the source-derived row hash are
redacted. The opaque row identifier, import relationship, row index,
classification, status, reconciliation membership, and review audit remain
until the 365-day metadata boundary. Profile, preset, and paper-account records
remain until account deletion except where a shorter category-specific rule
applies. Each retention execution writes one service-only run row with status,
timestamps, bounded deletion/redaction outcome counts, and an SQLSTATE error
code. A failed destructive subtransaction rolls back its partial work while
retaining the failed run for diagnosis.

## Operations and incident response

Inspect recent runs with a service-role or direct database connection:

```sql
select
  id,
  status,
  started_at,
  completed_at,
  deleted_counts,
  error_code
from public.account_data_retention_runs
order by started_at desc
limit 20;
```

Inspect the scheduler without exposing account contents:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'alpha-dog-account-data-retention';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid
  from cron.job
  where jobname = 'alpha-dog-account-data-retention'
)
order by start_time desc
limit 20;
```

For a failed deletion, use its request id from server-side diagnostics and
inspect only stage timestamps, status, attempt count, bounded result counts,
and `last_error_code`. Do not copy token hashes or account fingerprints into
logs or support tickets. The user should retry from the same browser within 24
hours; an expired retry requires a new recent sign-in.

## Backups and recovery

Deletion removes the user from active product systems. Disaster-recovery
backups can retain deleted bytes until the infrastructure provider's backup
expiration schedule. Those backups are not a product-level archive and must
not be used to restore an individual deleted account. Supabase's
[database-backup documentation](https://supabase.com/docs/guides/platform/backups)
describes project backup behavior; operators must review the live project plan
and retention settings before changing the user-facing notice.

## Verification

Run the full clean-database gate:

```bash
npm run test:supabase
```

That gate reconstructs the database from migrations, runs pgTAP catalog
contracts, verifies anonymous/authenticated/service-role Data API isolation,
and executes the two-user account lifecycle verifier. The lifecycle verifier
proves user-isolated export, service-only destructive RPCs, durable tombstone
rotation, pre-revocation write denial, revoked-JWT profile/identity recreation
denial, idempotent application deletion, Auth hard deletion, exact relational
retention boundaries, and observable run records.

Before production release:

1. obtain product-owner or designated privacy/legal approval for the Privacy
   notice and Terms copy;
2. apply and verify the pending migration before moving application `main`;
3. rerun Supabase security/performance advisors;
4. verify the exact production cron row and latest successful run; and
5. exercise export and deletion with two disposable production-safe test
   accounts, never with a real user's account.
