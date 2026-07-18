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
    expect(migration).toContain("metadata->>'idempotencyKey'");
    expect(migration).toContain("simulated_equity_lots_statement_import_source_unique");
    expect(migration).toContain("source_fingerprint text");
  });

  it("finalizes positions, legs, events, and equity lots in a security-invoker RPC", () => {
    expect(migration).toContain("create or replace function public.finalize_statement_import_atomic");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = public");
    expect(migration).toContain("insert into public.simulated_positions");
    expect(migration).toContain("insert into public.simulated_position_legs");
    expect(migration).toContain("insert into public.simulated_position_events");
    expect(migration).toContain("insert into public.simulated_equity_lots");
  });

  it("keeps ownership and execution privileges scoped to authenticated users", () => {
    expect(migration).toContain("v_user_id uuid := auth.uid()");
    expect(migration).toContain("if p_user_id <> v_user_id then");
    expect(migration).toContain(
      "revoke all on function public.finalize_statement_import_atomic(uuid, jsonb, jsonb, jsonb)",
    );
    expect(migration).toContain("from public, anon");
    expect(migration).toContain(
      "grant execute on function public.finalize_statement_import_atomic(uuid, jsonb, jsonb, jsonb)",
    );
    expect(migration).toContain("to authenticated");
  });
});
