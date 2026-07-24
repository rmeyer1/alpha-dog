import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseAdminClient = vi.hoisted(() => vi.fn());
const waitUntil = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdminClient,
}));
vi.mock("@vercel/functions", () => ({
  waitUntil,
}));

import {
  flushScheduledAlertSamplesForTests,
  recordAlertSample,
  scheduleAlertSample,
} from "./alert-control-plane";

describe("durable alert control-plane adapter", () => {
  beforeEach(() => {
    vi.stubEnv("ALPHA_DOG_TEST_ALERT_CONTROL_PLANE", "true");
    getSupabaseAdminClient.mockReset();
    waitUntil.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports unavailable storage without attempting delivery", async () => {
    getSupabaseAdminClient.mockReturnValue(null);

    await expect(recordAlertSample("workflow_failure", 1)).resolves.toBeNull();
    expect(scheduleAlertSample("provider_error_rate", 1)).toBe(false);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("persists sanitized samples and returns database-native events", async () => {
    const event = {
      alert_key: "workflow_failure",
      event_id: crypto.randomUUID(),
      outcome: "triggered",
      severity: "error",
    };
    const rpc = vi.fn(async () => ({ data: [event], error: null }));

    getSupabaseAdminClient.mockReturnValue({ rpc });

    await expect(recordAlertSample("workflow_failure", 1)).resolves.toEqual([
      event,
    ]);
    expect(rpc).toHaveBeenCalledWith(
      "record_observability_alert_sample",
      expect.objectContaining({
        p_alert_key: "workflow_failure",
        p_occurred_at: expect.any(String),
        p_value: 1,
      }),
    );
  });

  it("uses Vercel background work without blocking business responses", async () => {
    const event = {
      alert_key: "provider_error_rate",
      event_id: crypto.randomUUID(),
      outcome: "triggered",
      severity: "warn",
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let release: (() => void) | null = null;
    const rpc = vi.fn(() => new Promise((resolve) => {
      release = () => resolve({ data: [event], error: null });
    }));

    getSupabaseAdminClient.mockReturnValue({ rpc });

    expect(scheduleAlertSample("provider_error_rate", 0)).toBe(true);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));

    release?.();
    await flushScheduledAlertSamplesForTests();
    expect(rpc).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"event":"alert.event"'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('"alertKey":"provider_error_rate"'),
    );

    warn.mockRestore();
  });

  it("contains failed background persistence", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({
      data: null,
      error: new Error("service-role secret canary"),
    }));

    getSupabaseAdminClient.mockReturnValue({ rpc });
    scheduleAlertSample("paid_usage_anomaly", 1);
    await flushScheduledAlertSamplesForTests();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('"event":"alert.delivery_failed"'),
    );
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      "service-role secret canary",
    );

    error.mockRestore();
  });
});
