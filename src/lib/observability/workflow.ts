import {
  createDurableTelemetryContext,
  normalizeDurableTelemetryContext,
  runWithTelemetryContext,
  type DurableTelemetryContext,
} from "./context";
import { dispatchAlert } from "./alerts";
import { emitTelemetry } from "./telemetry";

export type WorkflowName = "wheel_deep_scan" | "wheel_screener";
export type WorkflowPhase =
  | "completed"
  | "failed"
  | "resumed"
  | "started";

export function workflowTelemetryArguments<T>(
  request: T,
): [T, DurableTelemetryContext] {
  return [request, createDurableTelemetryContext()];
}

export async function observedWorkflowArguments<T>(
  workflow: WorkflowName,
  request: T,
): Promise<[T, DurableTelemetryContext]> {
  const args = workflowTelemetryArguments(request);

  await emitWorkflowTelemetry({
    context: args[1],
    phase: "started",
    workflow,
  });

  return args;
}

export function runWithDurableTelemetryContext<T>(
  context: DurableTelemetryContext | null | undefined,
  callback: (normalized: DurableTelemetryContext) => Promise<T>,
) {
  const normalized = normalizeDurableTelemetryContext(context);

  return runWithTelemetryContext(
    { correlationId: normalized.correlationId },
    () => callback(normalized),
  );
}

export async function emitWorkflowTelemetry(options: {
  context: DurableTelemetryContext;
  error?: unknown;
  phase: WorkflowPhase;
  workflow: WorkflowName;
}) {
  emitTelemetry({
    correlationId: options.context.correlationId,
    error: options.error,
    errorCode:
      options.phase === "failed" ? "WORKFLOW_FAILED" : undefined,
    event: "workflow.lifecycle",
    logicalOperationId: options.context.logicalOperationId,
    outcome: options.phase,
    severity: options.phase === "failed" ? "error" : "info",
    workflow: options.workflow,
  });

  if (options.phase === "failed") {
    await dispatchAlert("workflow_failure", "triggered");
  }
}
