import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260728043000_add_scanner_parity_rollout.sql",
  "utf8",
);

describe("scanner parity rollout migration", () => {
  it("keeps controls and observations service-only with bounded samples", () => {
    expect(migration).toContain(
      "alter table public.wheel_scanner_rollout_control force row level security",
    );
    expect(migration).toContain(
      "alter table public.wheel_scanner_parity_observations",
    );
    expect(migration).toContain("pg_catalog.jsonb_array_length(samples) <= 10");
    expect(migration).toContain(
      "from public, anon, authenticated",
    );
    expect(migration).toContain("to service_role");
  });

  it("defaults to legacy and exposes an immediate server-side rollback RPC", () => {
    expect(migration).toContain("read_source text not null default 'legacy'");
    expect(migration).toContain(
      "public.set_wheel_scanner_read_source(",
    );
    expect(migration).toContain(
      "p_read_source not in ('legacy', 'replacement')",
    );
  });

  it("persists the 14-day observation evidence dimensions", () => {
    expect(migration).toContain("'market_days_observed'");
    expect(migration).toContain("'exact_ratio'");
    expect(migration).toContain("'financial_mismatch_count'");
    expect(migration).toContain("'eligibility_mismatch_count'");
  });
});
