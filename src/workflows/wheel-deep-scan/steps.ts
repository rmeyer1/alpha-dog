import {
  completeStagedUniverseDeepScanCoverage,
  failStagedUniverseDeepScanCoverage,
  stageUniverseDeepScanCoverage,
  type UniverseDeepScanCoverageRequest,
} from "@/lib/wheel/universe-scanner";
import type { DurableTelemetryContext } from "@/lib/observability/context";
import {
  emitWorkflowTelemetry,
  runWithDurableTelemetryContext,
} from "@/lib/observability/workflow";

export async function stageDeepScanCoverageBatch(
  request: UniverseDeepScanCoverageRequest,
  idempotencyKey: string,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  return runWithDurableTelemetryContext(
    telemetryContext,
    () => stageUniverseDeepScanCoverage(request, idempotencyKey),
  );
}

export async function completeDeepScanCoverageBatch(
  runId: string,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  return runWithDurableTelemetryContext(
    telemetryContext,
    () => completeStagedUniverseDeepScanCoverage(runId),
  );
}

export async function failDeepScanCoverageBatch(
  runId: string,
  errorMessage: string,
  telemetryContext: DurableTelemetryContext,
) {
  "use step";

  await runWithDurableTelemetryContext(
    telemetryContext,
    () => failStagedUniverseDeepScanCoverage(runId, new Error(errorMessage)),
  );
}

export async function recordDeepScanWorkflowLifecycle(
  telemetryContext: DurableTelemetryContext,
  phase: "completed" | "failed" | "resumed",
) {
  "use step";

  await runWithDurableTelemetryContext(telemetryContext, (normalized) =>
    emitWorkflowTelemetry({
      context: normalized,
      phase,
      workflow: "wheel_deep_scan",
    })
  );
}
