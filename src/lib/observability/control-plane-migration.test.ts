import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALERT_RULES } from "./alerts";

const migration = readFileSync(
  "supabase/migrations/20260724111354_add_observability_control_plane.sql",
  "utf8",
);
const vitestConfig = readFileSync("vitest.config.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons?: Array<{ path: string; schedule: string }>;
};

describe("observability control-plane migration", () => {
  it("coordinates readiness refreshes across instances", () => {
    expect(migration).toContain("observability_readiness_state");
    expect(migration).toContain("claim_observability_readiness_refresh");
    expect(migration).toContain("refresh_lease_until <=");
    expect(migration).toContain("refresh_owner = p_owner");
    expect(vercel.crons).toContainEqual({
      path: "/api/health/ready/refresh",
      schedule: "* * * * *",
    });
  });

  it("creates a scheduled evaluator and durable native alert events", () => {
    expect(migration).toContain("evaluate_observability_alerts");
    expect(migration).toContain("record_observability_alert_sample");
    expect(migration).toContain("pg_try_advisory_xact_lock");
    expect(migration).toContain("cron.schedule");
    expect(migration).toContain("alpha_dog_observability_alerts");
    expect(migration).toContain("pg_notify");
    expect(migration).toContain("observability_alert_events");
  });

  it("detects an absent durable readiness cron heartbeat", () => {
    expect(migration).toContain(
      "v_rule.alert_key = 'cron_refresh_missing'",
    );
    expect(migration).toContain(
      "from public.observability_readiness_state as r",
    );
    expect(migration).toContain(
      "p_now - pg_catalog.make_interval(secs => v_rule.window_seconds)",
    );
    expect(migration).toContain(
      "v_metric_value := greatest(v_metric_value, 1::numeric)",
    );
  });

  it("enforces coverage thresholds for every observability source file", () => {
    expect(vitestConfig).toContain(
      '"src/lib/observability/**/*.ts"',
    );
    expect(vitestConfig).toContain("perFile: true");
    for (const metric of ["branches", "functions", "lines", "statements"]) {
      expect(vitestConfig).toContain(`${metric}: 80`);
    }
  });

  it("keeps every application rule synchronized with the database evaluator", () => {
    for (const [alertKey, rule] of Object.entries(ALERT_RULES)) {
      expect(migration).toContain(`'${alertKey}'`);
      expect(migration).toContain(rule.destination);
      expect(migration).toMatch(
        new RegExp(
          `'${alertKey}'[\\s\\S]+?${rule.threshold}[\\s\\S]+?` +
            `${rule.windowSeconds}[\\s\\S]+?${rule.minimumSamples}`,
        ),
      );
    }
  });

  it("enforces RLS and service-role-only Data API access", () => {
    for (const table of [
      "observability_readiness_state",
      "observability_alert_rules",
      "observability_alert_samples",
      "observability_alert_state",
      "observability_alert_events",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(
        `alter table public.${table} force row level security`,
      );
    }

    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
    expect(migration).toContain("set search_path = ''");
  });
});
