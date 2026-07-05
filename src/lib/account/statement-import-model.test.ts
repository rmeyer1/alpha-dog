import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260705212000_create_statement_import_model.sql",
  "utf8",
);

describe("statement import data model migration", () => {
  it("creates import batches, normalized rows, reconciliation groups, and group rows", () => {
    expect(migration).toContain("create table if not exists public.statement_imports");
    expect(migration).toContain("create table if not exists public.statement_import_rows");
    expect(migration).toContain("create table if not exists public.statement_reconciliation_groups");
    expect(migration).toContain("create table if not exists public.statement_reconciliation_group_rows");
  });

  it("supports exact-file and cross-import row dedupe fingerprints", () => {
    expect(migration).toContain(
      "constraint statement_imports_user_broker_file_unique unique (user_id, broker, file_hash)",
    );
    expect(migration).toContain(
      "constraint statement_import_rows_user_hash_unique unique (user_id, row_hash)",
    );
    expect(migration).toContain(
      "constraint statement_import_rows_import_index_unique unique (import_id, row_index)",
    );
  });

  it("preserves raw CSV rows and normalized broker activity fields", () => {
    expect(migration).toContain("raw_row jsonb not null");
    expect(migration).toContain("activity_date date");
    expect(migration).toContain("process_date date");
    expect(migration).toContain("settle_date date");
    expect(migration).toContain("instrument text");
    expect(migration).toContain("description text");
    expect(migration).toContain("trans_code text");
    expect(migration).toContain("classification text not null default 'unknown'");
    expect(migration).toContain("confidence numeric(5, 4)");
  });

  it("can connect normalized rows into reconciliation strategy candidates", () => {
    expect(migration).toContain(
      "import_id uuid not null references public.statement_imports(id) on delete cascade",
    );
    expect(migration).toContain(
      "group_id uuid not null references public.statement_reconciliation_groups(id) on delete cascade",
    );
    expect(migration).toContain(
      "row_id uuid not null references public.statement_import_rows(id) on delete cascade",
    );
    expect(migration).toContain("primary key (group_id, row_id)");
    expect(migration).toContain("'option_strategy'");
    expect(migration).toContain("'put_credit_spread'");
    expect(migration).toContain("'call_credit_spread'");
  });
});
