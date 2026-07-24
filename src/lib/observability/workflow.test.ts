import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAlertStateForTests } from "./alerts";
import {
  normalizeDurableTelemetryContext,
} from "./context";
import {
  emitWorkflowTelemetry,
  observedWorkflowArguments,
  type WorkflowName,
} from "./workflow";

beforeEach(() => {
  resetAlertStateForTests();
});

describe("durable workflow telemetry", () => {
  it.each([
    "wheel_deep_scan",
    "wheel_screener",
  ] satisfies WorkflowName[])(
    "preserves %s correlation and logical identity across serialization",
    async (workflow) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const [request, context] = await observedWorkflowArguments(workflow, {
        requestKey: "safe",
      });
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
      expect(serialized).toContain(`"correlationId":"${context.correlationId}"`);
      expect(serialized).toContain(
        `"logicalOperationId":"${context.logicalOperationId}"`,
      );
      expect(serialized.match(/"outcome":"started"/g)).toHaveLength(1);
      expect(serialized.match(/"outcome":"resumed"/g)).toHaveLength(1);
      expect(serialized.match(/"outcome":"failed"/g)).toHaveLength(1);
      expect(serialized).toContain('"event":"alert.event"');
      expect(serialized).not.toContain("workflow payload canary");

      info.mockRestore();
      error.mockRestore();
    },
  );
});
