import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260723234909_stabilize_scanner_concurrency.sql",
  ),
  "utf8",
);

describe("scanner concurrency migration", () => {
  it("uses an atomic expiring owner lease with private service-role RPCs", () => {
    expect(migration).toContain("create table if not exists public.wheel_scan_leases");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("v_current.expires_at <= v_now");
    expect(migration).toContain("v_current.owner_id = p_owner_id");
    expect(migration).toContain("where lease_key = p_lease_key");
    expect(migration).toContain("and owner_id = p_owner_id");
    expect(migration).toContain("alter table public.wheel_scan_leases enable row level security");
    expect(migration).toContain(
      "revoke all on public.wheel_scan_leases from public, anon, authenticated",
    );
    expect(migration).toContain("to service_role");
  });

  it("adds real run heartbeats and the deep-scan workflow checkpoint", () => {
    expect(migration).toContain(
      "alter table public.wheel_universe_scan_runs",
    );
    expect(migration).toContain("alter table public.wheel_deep_scan_runs");
    expect(migration).toContain(
      "add column if not exists heartbeat_at timestamptz not null default now()",
    );
    expect(migration).toContain(
      "add column if not exists workflow_result jsonb",
    );
  });
});
