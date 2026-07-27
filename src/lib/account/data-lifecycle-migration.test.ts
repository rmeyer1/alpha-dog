import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260727121438_add_account_data_lifecycle.sql",
  "utf8",
);

describe("account data lifecycle migration", () => {
  it("keeps lifecycle operations invoker-scoped with least privilege", () => {
    for (
      const signature of [
        "public.export_account_data()",
        "public.prepare_account_deletion_request",
        "public.delete_account_application_data(uuid)",
        "public.run_account_data_retention()",
      ]
    ) {
      expect(migration).toContain(`function ${signature}`);
    }

    expect(migration.match(/security invoker/g)).toHaveLength(4);
    expect(migration.match(/set search_path = ''/g)).toHaveLength(5);
    expect(migration).toContain(
      "grant execute on function public.export_account_data()\n  to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.delete_account_application_data(uuid)\n  to service_role",
    );
    expect(migration).toContain(
      "grant execute on function public.prepare_account_deletion_request(",
    );
    expect(migration).toContain(
      "grant execute on function public.run_account_data_retention()\n  to service_role",
    );
  });

  it("makes deletion retries observable without retaining direct identifiers", () => {
    expect(migration).toContain(
      "create table if not exists public.account_deletion_requests",
    );
    expect(migration).toContain("account_deletion_requests_completed_pseudonymous");
    expect(migration).toContain("user_id is null and");
    expect(migration).toContain("token_hash is null and");
    expect(migration).toContain(
      "alter table public.account_deletion_requests enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.account_deletion_requests\n  from public, anon, authenticated",
    );
    expect(migration).toContain(
      "create unique index if not exists account_deletion_requests_active_user_idx",
    );
    expect(migration).toContain(
      "create or replace function private.reject_tombstoned_account_write()",
    );
    expect(migration).toContain(
      "create trigger account_write_reject_deletion_tombstone",
    );
    expect(migration).toContain(
      "where account_deletion_requests.completed_at is not null",
    );
  });

  it("codifies and schedules the documented retention policy", () => {
    for (
      const interval of [
        "interval '30 days'",
        "interval '90 days'",
        "interval '365 days'",
      ]
    ) {
      expect(migration).toContain(interval);
    }

    expect(migration).toContain(
      "create table if not exists public.account_data_retention_runs",
    );
    expect(migration).toContain(
      "'alpha-dog-account-data-retention',\n    '15 3 * * *'",
    );
    expect(migration).toContain("perform cron.unschedule(v_job_id)");
    expect(migration).toContain(
      "row_hash = 'retained:' || statement_row.id::text",
    );
    expect(migration).toContain("'rawImportRowsRedacted'");
  });

  it("exports every account-owned data category through auth.uid", () => {
    expect(migration).toContain("v_user_id uuid := (select auth.uid())");

    for (
      const category of [
        "'profile'",
        "'identities'",
        "'presets'",
        "'analysisRequests'",
        "'paperAccounts'",
        "'positions'",
        "'positionLegs'",
        "'positionEvents'",
        "'equityLots'",
        "'statementImports'",
        "'statementImportRows'",
        "'reconciliationGroups'",
        "'reconciliationGroupRows'",
        "'reviewAudit'",
      ]
    ) {
      expect(migration).toContain(category);
    }
  });
});
