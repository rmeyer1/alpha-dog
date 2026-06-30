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
const migrations = `${foundation}\n${hardening}`;

describe("account-owned Supabase RLS policies", () => {
  it.each([
    ["account_profiles", "id"],
    ["account_identities", "user_id"],
    ["saved_presets", "user_id"],
    ["analysis_requests", "user_id"],
  ])("enables RLS and owner policies for %s", (table, ownerColumn) => {
    expect(migrations).toContain(`alter table public.${table} enable row level security`);
    expect(hardening).toContain(`on public.${table}`);
    expect(hardening).toContain(`using ((select auth.uid()) = ${ownerColumn})`);
  });
});
