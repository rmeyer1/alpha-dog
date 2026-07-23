import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260720224500_create_api_abuse_protection.sql",
  "utf8",
);

describe("API abuse protection migration", () => {
  it("coordinates rate and concurrency limits atomically across instances", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("api_abuse_rate_windows");
    expect(migration).toContain("api_abuse_leases");
    expect(migration).toContain("v_active_count >= p_concurrency_limit");
    expect(migration).toContain("on conflict (route_key, scope_kind, scope_key, window_started_at)");
  });

  it("keeps usage metrics free of request bodies and financial context", () => {
    expect(migration).toContain("api_abuse_usage_metrics");
    expect(migration).not.toMatch(/request_body|payload|symbol|ticker|financial/i);
  });

  it("only exposes limiter RPCs to the service role", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("enable row level security");
  });

  it("does not schema-qualify SQL conditional expressions", () => {
    expect(migration).not.toMatch(/pg_catalog\.(?:coalesce|greatest)\s*\(/i);
  });
});
