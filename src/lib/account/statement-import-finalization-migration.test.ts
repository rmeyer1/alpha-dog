import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260718030000_finalize_statement_import_atomic.sql",
  "utf8",
);

describe("statement import atomic finalization migration", () => {
  it("adds database-enforced idempotency for imported ledger records", () => {
    expect(migration).toContain("simulated_positions_statement_import_source_unique");
    expect(migration).toContain("where source = 'statement_import' and external_source_id is not null");
    expect(migration).toContain("simulated_position_events_statement_import_key_unique");
    expect(migration).toContain("position_id,");
    expect(migration).toContain("metadata->>'idempotencyKey'");
    expect(migration).toContain("simulated_equity_lots_statement_import_source_unique");
    expect(migration).toContain("source_fingerprint text");
    expect(migration).toContain("simulated_positions_statement_import_source_required");
    expect(migration).toContain("simulated_position_events_statement_import_key_required");
    expect(migration).toContain("STATEMENT_IMPORT_EQUITY_FINGERPRINT_REQUIRED");
  });

  it("finalizes positions, legs, events, and equity lots in a security-invoker RPC", () => {
    expect(migration).toContain("create or replace function public.finalize_statement_import_atomic");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("insert into public.simulated_positions");
    expect(migration).toContain("insert into public.simulated_position_legs");
    expect(migration).toContain("insert into public.simulated_position_events");
    expect(migration).toContain("insert into public.simulated_equity_lots");
  });

  it("keeps ownership and execution privileges scoped to authenticated users", () => {
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("if p_user_id is distinct from v_user_id then");
    expect(migration).toContain(
      "revoke all on function public.finalize_statement_import_atomic(uuid, jsonb, jsonb, jsonb)",
    );
    expect(migration).toContain("from public, anon");
    expect(migration).toContain(
      "grant select, insert on table public.paper_accounts to authenticated",
    );
    expect(migration).toContain(
      "grant select, insert on table public.simulated_positions to authenticated",
    );
    expect(migration).toContain(
      "grant insert on table public.simulated_position_events to authenticated",
    );
    expect(migration).toContain(
      "grant select, insert on table public.simulated_equity_lots to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.finalize_statement_import_atomic(uuid, jsonb, jsonb, jsonb)",
    );
    expect(migration).toContain("to authenticated");
  });
});
