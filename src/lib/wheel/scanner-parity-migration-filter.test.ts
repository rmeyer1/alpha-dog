import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260730000000_fix_parity_metrics_batch_status.sql",
  "utf8",
);

describe("parity metrics batch-status filter migration", () => {
  it("creates or replaces the RPC as service-role only", () => {
    expect(migration).toContain(
      "create or replace function public.get_wheel_scanner_parity_metrics",
    );
    expect(migration).toContain("language sql");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "from public, anon, authenticated",
    );
    expect(migration).toContain("to service_role");
  });

  it("joins wheel_market_batches and filters to only completed batches", () => {
    expect(migration).toContain(
      "join public.wheel_market_batches as batches",
    );
    expect(migration).toContain(
      "batches.id = obs.batch_id",
    );
    expect(migration).toContain(
      "batches.status = 'complete'",
    );
  });

  it("enforces cohort integrity by matching observation count to snapshot_count", () => {
    expect(migration).toContain(
      "batches.snapshot_count as expected_count",
    );
    expect(migration).toContain(
      "cohort.observation_count = cohort.expected_count",
    );
  });

  it("excludes observations from running and failed batches", () => {
    // The WHERE clause only admits status = 'complete', which
    // implicitly excludes 'running' and 'failed'.
    expect(migration).toContain("where obs.observed_at::date");
    // Ensure the status filter is part of the WHERE, not applied post-join.
    const wherePos = migration.indexOf("where obs.observed_at");
    const statusPos = migration.indexOf("batches.status = 'complete'");
    expect(statusPos).toBeGreaterThan(wherePos);
  });

  it("preserves all evidence dimensions from the original RPC", () => {
    expect(migration).toContain("'market_days_observed'");
    expect(migration).toContain("'observation_count'");
    expect(migration).toContain("'exact_count'");
    expect(migration).toContain("'mismatch_count'");
    expect(migration).toContain("'exact_ratio'");
    expect(migration).toContain("'financial_mismatch_count'");
    expect(migration).toContain("'eligibility_mismatch_count'");
    expect(migration).toContain("'score_mismatch_count'");
    expect(migration).toContain("'warning_mismatch_count'");
    expect(migration).toContain("'ordering_mismatch_count'");
  });
});