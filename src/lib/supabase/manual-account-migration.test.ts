import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260721150739_harden_manual_account_invitations.sql",
  "utf8",
);

describe("manual account invitation migration", () => {
  it("repairs the general limiter for already-migrated environments", () => {
    expect(migration).toContain("pg_get_functiondef");
    expect(migration).toContain(
      "public.acquire_api_abuse_budget(text,uuid,text,integer,integer,integer,integer,integer,uuid)",
    );
  });

  it("creates manual profiles in the auth-user transaction", () => {
    expect(migration).toContain("after insert on auth.users");
    expect(migration).toContain("manual_account_invite");
    expect(migration).toContain("insert into public.account_profiles");
    expect(migration).toContain("private.create_manual_account_invite_profile");
  });

  it("keeps the trigger function private and non-callable", () => {
    expect(migration).toContain("create schema if not exists private");
    expect(migration).toContain("security definer");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toMatch(
      /revoke all on function private\.create_manual_account_invite_profile\(\)[\s\S]+service_role/,
    );
  });

  it("coordinates hashed IP and email budgets atomically", () => {
    expect(migration).toContain("acquire_manual_account_invite_budget");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("scope_kind = 'email'");
    expect(migration).toContain("scope_key = p_email_hash");
    expect(migration).not.toMatch(/p_email\s+text/);
  });

  it("exposes the invitation budget only to the service role", () => {
    expect(migration).toMatch(
      /revoke all on function public\.acquire_manual_account_invite_budget[\s\S]+from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.acquire_manual_account_invite_budget[\s\S]+to service_role/,
    );
  });

  it("does not schema-qualify SQL conditional expressions", () => {
    expect(migration).not.toMatch(/pg_catalog\.(?:coalesce|greatest)\s*\(/i);
  });
});
