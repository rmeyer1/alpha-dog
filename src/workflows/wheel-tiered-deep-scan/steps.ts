import {
  completeDeepScanWorkBatch,
  failDeepScanWorkBatch,
  heartbeatDeepScanWork,
} from "@/lib/wheel/deep-scan-work/repository";
import { resultsForDeepScanClaims } from
  "@/lib/wheel/deep-scan-work/domain";
import { publishTieredDeepScanCompatibility } from
  "@/lib/wheel/deep-scan-work/service";
import { finalizeSharedMarketCoverageFacts } from
  "@/lib/wheel/market-batch/service";
import type {
  DeepScanWorkClaim,
  DeepScanWorkResult,
} from "@/lib/wheel/deep-scan-work/model";
import type {
  MarketBatchOptionStageSummary,
  MarketBatchUnderlyingStageSummary,
} from "@/lib/wheel/market-batch/model";
import type { WheelScreenerRequest } from "@/lib/wheel/types";
import type { DurableTelemetryContext } from "@/lib/observability/context";
import {
  emitWorkflowTelemetry,
  runWithDurableTelemetryContext,
} from "@/lib/observability/workflow";

export async function recordTieredDeepScanWorkflowLifecycle(
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

export async function heartbeatTieredDeepScanStep({
  claims,
  leaseSeconds,
  ownerId,
}: {
  claims: DeepScanWorkClaim[];
  leaseSeconds: number;
  ownerId: string;
}) {
  "use step";

  return heartbeatDeepScanWork({
    claims,
    leaseSeconds,
    ownerId,
  });
}

export async function resultsForTieredDeepScanClaimsStep(
  claims: DeepScanWorkClaim[],
  optionStages: MarketBatchOptionStageSummary[],
) {
  "use step";

  return resultsForDeepScanClaims(claims, optionStages);
}

export async function finalizeTieredDeepScanFactsStep(
  batchId: string,
  underlyingStage: MarketBatchUnderlyingStageSummary,
  optionStages: MarketBatchOptionStageSummary[],
) {
  "use step";

  return finalizeSharedMarketCoverageFacts({
    batchId,
    optionStages,
    underlyingStage,
  });
}

export async function publishTieredDeepScanCompatibilityStep({
  batchId,
  claims,
  leaseSeconds,
  optionStages,
  ownerId,
  requests,
}: {
  batchId: string;
  claims: DeepScanWorkClaim[];
  leaseSeconds: number;
  optionStages: MarketBatchOptionStageSummary[];
  ownerId: string;
  requests: WheelScreenerRequest[];
}) {
  "use step";

  return publishTieredDeepScanCompatibility({
    batchId,
    claims,
    leaseSeconds,
    optionStages,
    ownerId,
    requests,
  });
}

export async function completeTieredDeepScanStep({
  batchId,
  ownerId,
  results,
}: {
  batchId: string;
  ownerId: string;
  results: DeepScanWorkResult[];
}) {
  "use step";

  return completeDeepScanWorkBatch({
    batchId,
    ownerId,
    results,
  });
}

export async function failTieredDeepScanStep({
  batchId,
  claims,
  error,
  ownerId,
}: {
  batchId: string;
  claims: DeepScanWorkClaim[];
  error: string;
  ownerId: string;
}) {
  "use step";

  return failDeepScanWorkBatch({
    batchId,
    claims,
    error,
    ownerId,
  });
}
