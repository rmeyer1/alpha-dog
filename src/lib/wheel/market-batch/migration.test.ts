import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727201158_create_shared_market_batch_pipeline.sql",
  ),
  "utf8",
);

describe("shared market batch migration", () => {
  it("keeps every batch object service-role only behind forced RLS", () => {
    for (const table of [
      "wheel_market_batches",
      "wheel_market_batch_underlyings",
      "wheel_market_batch_option_contracts",
      "wheel_market_batch_option_ingestions",
      "wheel_market_batch_snapshots",
      "wheel_market_batch_candidates",
      "wheel_market_batch_current_snapshots",
      "wheel_market_batch_metrics",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(
        `alter table public.${table} force row level security`,
      );
      expect(migration).toContain(
        `revoke all on table public.${table}`,
      );
    }
  });

  it("creates one canonical interval identity and atomic publication pointer", () => {
    expect(migration).toContain(
      "constraint wheel_market_batches_interval_feed_unique",
    );
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain(
      "create or replace function public.create_wheel_market_batch(",
    );
    expect(migration).toContain(
      "create or replace function public.publish_wheel_market_batch_snapshot(",
    );
    expect(migration).toContain(
      "insert into public.wheel_market_batch_current_snapshots",
    );
    expect(migration).toContain(
      "on conflict (persona, strategy, filter_key, feed)",
    );
    expect(migration).toContain(
      "Wheel market batch candidate count does not match.",
    );
  });

  it("defines idempotent completion and retention RPCs with narrow execution", () => {
    for (const functionName of [
      "create_wheel_market_batch",
      "complete_wheel_market_batch_facts",
      "checkpoint_wheel_market_batch_underlyings",
      "create_wheel_market_batch_snapshot",
      "publish_wheel_market_batch_snapshot",
      "complete_wheel_market_batch",
      "fail_wheel_market_batch",
      "prune_wheel_market_batch_history",
    ]) {
      expect(migration).toContain(
        `create or replace function public.${functionName}(`,
      );
    }

    expect(migration).toContain("security invoker");
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain("to service_role");
  });
});
