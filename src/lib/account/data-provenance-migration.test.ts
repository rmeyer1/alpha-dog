import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260723205141_add_data_source_provenance.sql",
  "utf8",
);

describe("data-source provenance migration", () => {
  it("separates materialized screener rows by explicit source mode", () => {
    expect(migration).toContain(
      "add column if not exists data_source_mode text not null default 'live'",
    );
    expect(migration).toContain(
      "wheel_screener_snapshots_data_source_mode_valid",
    );
    expect(migration).toContain(
      "feed,\n    data_source_mode,\n    status",
    );
  });

  it("retains candidate feed and cache provenance on simulated positions", () => {
    for (
      const column of [
        "candidate_feed",
        "candidate_cache_status",
        "candidate_cache_source",
        "candidate_as_of",
      ]
    ) {
      expect(migration).toContain(column);
    }

    expect(migration).toContain(
      "simulated_positions_candidate_mode_feed_match",
    );
    expect(migration).toContain(
      "'dataProvenance', v_provenance",
    );
  });

  it("keeps the atomic position opener security-invoker scoped", () => {
    expect(migration).toContain(
      "create or replace function public.open_simulated_position_atomic",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("v_user_id uuid := auth.uid()");
  });
});
