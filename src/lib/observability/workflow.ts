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

export async function startObservedWorkflow<TRequest, TResult>(
  workflow: WorkflowName,
  request: TRequest,
  startWorkflow: (
    args: [TRequest, DurableTelemetryContext],
  ) => Promise<TResult>,
): Promise<TResult> {
  const args = workflowTelemetryArguments(request);

  try {
    const result = await startWorkflow(args);

    await emitWorkflowTelemetry({
      context: args[1],
      phase: "started",
      workflow,
    });

    return result;
  } catch (error) {
    await emitWorkflowTelemetry({
      context: args[1],
      error,
      phase: "failed",
      workflow,
    });
    throw error;
  }
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
    durationMs: Math.max(
      0,
      Date.now() - options.context.startedAtEpochMs,
    ),
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
  } else if (options.phase === "completed") {
    await dispatchAlert("workflow_failure", "recovered");
  }
}
