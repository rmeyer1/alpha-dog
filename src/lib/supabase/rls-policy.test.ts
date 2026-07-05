import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const foundation = readFileSync(
  "supabase/migrations/20260630020500_create_account_auth_foundation.sql",
  "utf8",
);
const hardening = readFileSync(
  "supabase/migrations/20260630022000_harden_account_auth_policies.sql",
  "utf8",
);
const simulatedPositions = readFileSync(
  "supabase/migrations/20260702200000_create_simulated_position_tracker.sql",
  "utf8",
);
const statementImports = readFileSync(
  "supabase/migrations/20260705212000_create_statement_import_model.sql",
  "utf8",
);
const migrations =
  `${foundation}\n${hardening}\n${simulatedPositions}\n${statementImports}`;

describe("account-owned Supabase RLS policies", () => {
  it.each([
    ["account_profiles", "id"],
    ["account_identities", "user_id"],
    ["saved_presets", "user_id"],
    ["analysis_requests", "user_id"],
    ["paper_accounts", "user_id"],
    ["simulated_positions", "user_id"],
    ["simulated_position_events", "user_id"],
    ["simulated_equity_lots", "user_id"],
    ["statement_imports", "user_id"],
    ["statement_import_rows", "user_id"],
    ["statement_reconciliation_groups", "user_id"],
  ])("enables RLS and owner policies for %s", (table, ownerColumn) => {
    expect(migrations).toContain(`alter table public.${table} enable row level security`);
    expect(migrations).toContain(`on public.${table}`);
    expect(migrations).toContain(`using ((select auth.uid()) = ${ownerColumn})`);
  });

  it("scopes simulated position legs through their owner position", () => {
    expect(simulatedPositions).toContain(
      "alter table public.simulated_position_legs enable row level security",
    );
    expect(simulatedPositions).toContain(
      "from public.simulated_positions owner_position",
    );
    expect(simulatedPositions).toContain(
      "where owner_position.id = position_id",
    );
    expect(simulatedPositions).toContain(
      "and owner_position.user_id = (select auth.uid())",
    );
  });

  it("scopes assigned equity lots to an owned source position when present", () => {
    expect(simulatedPositions).toContain(
      "source_position_id is null or exists",
    );
    expect(simulatedPositions).toContain(
      "from public.simulated_positions owner_position",
    );
    expect(simulatedPositions).toContain(
      "where owner_position.id = source_position_id",
    );
    expect(simulatedPositions).toContain(
      "and owner_position.user_id = (select auth.uid())",
    );
    expect(simulatedPositions).toContain(
      "and owner_position.paper_account_id = paper_account_id",
    );
  });

  it("scopes statement import child rows through their owner import", () => {
    expect(statementImports).toContain(
      "alter table public.statement_import_rows enable row level security",
    );
    expect(statementImports).toContain(
      "alter table public.statement_reconciliation_groups enable row level security",
    );
    expect(statementImports).toContain(
      "from public.statement_imports owner_import",
    );
    expect(statementImports).toContain(
      "where owner_import.id = import_id",
    );
    expect(statementImports).toContain(
      "and owner_import.user_id = (select auth.uid())",
    );
  });

  it("scopes statement reconciliation group rows through owned groups and rows", () => {
    expect(statementImports).toContain(
      "alter table public.statement_reconciliation_group_rows enable row level security",
    );
    expect(statementImports).toContain(
      "from public.statement_reconciliation_groups owner_group",
    );
    expect(statementImports).toContain(
      "join public.statement_import_rows owner_row",
    );
    expect(statementImports).toContain(
      "where owner_group.id = group_id",
    );
    expect(statementImports).toContain(
      "and owner_group.user_id = (select auth.uid())",
    );
    expect(statementImports).toContain(
      "and owner_row.user_id = (select auth.uid())",
    );
    expect(statementImports).toContain(
      "and owner_group.import_id = owner_row.import_id",
    );
  });
});
