import type {
  UniverseDeepScanCoverageRequest,
  UniverseDeepScanCoverageResult,
} from "@/lib/wheel/universe-scanner";
import {
  requireDurableTelemetryContext,
  type DurableTelemetryContext,
} from "@/lib/observability/durable-context";
import {
  completeDeepScanCoverageBatch,
  failDeepScanCoverageBatch,
  recordDeepScanWorkflowLifecycle,
  stageDeepScanCoverageBatch,
} from "./steps";

export async function wheelDeepScanWorkflow(
  request: UniverseDeepScanCoverageRequest,
  telemetryContext: DurableTelemetryContext,
): Promise<UniverseDeepScanCoverageResult> {
  "use workflow";

  const telemetry = requireDurableTelemetryContext(telemetryContext);
  await recordDeepScanWorkflowLifecycle(telemetry, "resumed");

  try {
    if (!request.workflowIdempotencyKey) {
      throw new Error("Deep scan Workflow requires an idempotency key.");
    }

    const staged = await stageDeepScanCoverageBatch(
      request,
      request.workflowIdempotencyKey,
      telemetry,
    );

    if (!staged.runId) {
      if (!staged.result) {
        throw new Error("Deep scan was not staged and returned no result.");
      }

      await recordDeepScanWorkflowLifecycle(telemetry, "completed");
      return staged.result;
    }

    try {
      const result = await completeDeepScanCoverageBatch(staged.runId, telemetry);

      await recordDeepScanWorkflowLifecycle(telemetry, "completed");
      return result;
    } catch (error) {
      await failDeepScanCoverageBatch(
        staged.runId,
        error instanceof Error ? error.message : "Deep scan publication failed.",
        telemetry,
      );
      throw error;
    }
  } catch (error) {
    await recordDeepScanWorkflowLifecycle(telemetry, "failed");
    throw error;
  }
}
