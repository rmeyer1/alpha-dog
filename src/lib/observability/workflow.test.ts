import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleAlertSample = vi.hoisted(() => vi.fn(() => true));
vi.mock("./alert-control-plane", () => ({
  scheduleAlertSample,
}));

import {
  normalizeDurableTelemetryContext,
} from "./context";
import {
  emitWorkflowTelemetry,
  runWithDurableTelemetryContext,
  startObservedWorkflow,
  type WorkflowName,
} from "./workflow";

describe("durable workflow telemetry", () => {
  beforeEach(() => {
    scheduleAlertSample.mockClear();
  });

  it.each([
    "wheel_deep_scan",
    "wheel_screener",
  ] satisfies WorkflowName[])(
    "preserves %s correlation and logical identity across serialization",
    async (workflow) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const [request, context] = await startObservedWorkflow(
        workflow,
        { requestKey: "safe" },
        async (args) => args,
      );
      const resumed = normalizeDurableTelemetryContext(
        JSON.parse(JSON.stringify(context)),
      );

      await emitWorkflowTelemetry({
        context: resumed,
        phase: "resumed",
        workflow,
      });
      await emitWorkflowTelemetry({
        context: resumed,
        error: new Error("workflow payload canary"),
        phase: "failed",
        workflow,
      });

      const serialized = [...info.mock.calls, ...error.mock.calls]
        .map(([value]) => String(value))
        .join("\n");

      expect(request).toEqual({ requestKey: "safe" });
      expect(resumed).toEqual(context);
      expect(context.startedAtEpochMs).toBeGreaterThan(0);
      expect(serialized).toContain(`"correlationId":"${context.correlationId}"`);
      expect(serialized).toContain(
        `"logicalOperationId":"${context.logicalOperationId}"`,
      );
      expect(serialized.match(/"outcome":"started"/g)).toHaveLength(1);
      expect(serialized.match(/"outcome":"resumed"/g)).toHaveLength(1);
      expect(serialized.match(/"outcome":"failed"/g)).toHaveLength(1);
      expect(serialized).toMatch(/"durationMs":\d/);
      expect(scheduleAlertSample).toHaveBeenCalledWith(
        "workflow_failure",
        1,
      );
      expect(serialized).not.toContain("workflow payload canary");

      info.mockRestore();
      error.mockRestore();
    },
  );

  it("records enqueue failure without emitting an orphan start", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      startObservedWorkflow(
        "wheel_screener",
        { requestKey: "safe" },
        async () => {
          throw new Error("enqueue canary");
        },
      ),
    ).rejects.toThrow("enqueue canary");

    const serialized = [...info.mock.calls, ...error.mock.calls]
      .map(([value]) => String(value))
      .join("\n");

    expect(serialized).toContain('"outcome":"failed"');
    expect(serialized).not.toContain('"outcome":"started"');
    expect(serialized).not.toContain("enqueue canary");
    expect(scheduleAlertSample).toHaveBeenCalledWith(
      "workflow_failure",
      1,
    );

    info.mockRestore();
    error.mockRestore();
  });

  it("restores durable correlation during resumed work and emits recovery", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const context = normalizeDurableTelemetryContext(null);

    const activeCorrelationId = await runWithDurableTelemetryContext(
      context,
      async (normalized) => {
        await emitWorkflowTelemetry({
          context: normalized,
          phase: "completed",
          workflow: "wheel_deep_scan",
        });

        return normalized.correlationId;
      },
    );
    const serialized = info.mock.calls.flat().join("\n");

    expect(activeCorrelationId).toBe(context.correlationId);
    expect(serialized).toContain('"outcome":"completed"');
    expect(scheduleAlertSample).toHaveBeenCalledWith(
      "workflow_failure",
      0,
    );

    info.mockRestore();
  });
});
