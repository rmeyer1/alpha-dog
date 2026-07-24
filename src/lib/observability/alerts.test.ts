import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_RULES,
  dispatchAlert,
  resetAlertStateForTests,
} from "./alerts";

beforeEach(() => {
  resetAlertStateForTests();
});

describe("alert definitions and adapter", () => {
  it("defines numeric windows, thresholds, samples, cooldowns, and recovery", () => {
    expect(Object.keys(ALERT_RULES)).toEqual(expect.arrayContaining([
      "cron_refresh_missing",
      "import_finalization_failure",
      "paid_usage_anomaly",
      "provider_error_rate",
      "stale_screener_snapshot",
      "workflow_failure",
    ]));

    for (const rule of Object.values(ALERT_RULES)) {
      expect(rule.threshold).toBeGreaterThan(0);
      expect(rule.windowSeconds).toBeGreaterThan(0);
      expect(rule.minimumSamples).toBeGreaterThan(0);
      expect(rule.cooldownSeconds).toBeGreaterThan(0);
      expect(rule.recoveryConsecutiveSamples).toBeGreaterThan(0);
      expect(rule.owner).toBe("alpha_dog_operations");
      expect(rule.destination).toBe("vercel_runtime_alerts");
    }
  });

  it("deduplicates triggers, emits recovery, and contains adapter failure", async () => {
    const adapter = vi.fn();

    expect(
      await dispatchAlert("workflow_failure", "triggered", adapter),
    ).toBe(true);
    expect(
      await dispatchAlert("workflow_failure", "triggered", adapter),
    ).toBe(false);
    expect(
      await dispatchAlert("workflow_failure", "recovered", adapter),
    ).toBe(true);
    expect(adapter).toHaveBeenCalledTimes(2);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingAdapter = vi.fn(() => {
      throw new Error("webhook secret canary");
    });

    await expect(
      dispatchAlert("cron_refresh_missing", "triggered", failingAdapter),
    ).resolves.toBe(true);
    expect(JSON.stringify(error.mock.calls)).not.toContain(
      "webhook secret canary",
    );
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("alert.delivery_failed"),
    );
    error.mockRestore();
  });
});
