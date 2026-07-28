import type {
  TieredDeepScanWorkflowInput,
  TieredDeepScanWorkflowResult,
} from "@/lib/wheel/deep-scan-work/model";
import { optionUnitsForDeepScanClaims } from
  "@/lib/wheel/deep-scan-work/work-units";
import {
  requireDurableTelemetryContext,
  type DurableTelemetryContext,
} from "@/lib/observability/durable-context";
import {
  prepareMarketBatchStep,
  stageMarketBatchOptionStep,
  stageMarketBatchUnderlyingsStep,
} from "../wheel-market-batch/steps";
import {
  completeTieredDeepScanStep,
  failTieredDeepScanStep,
  finalizeTieredDeepScanFactsStep,
  heartbeatTieredDeepScanStep,
  publishTieredDeepScanCompatibilityStep,
  recordTieredDeepScanWorkflowLifecycle,
  resultsForTieredDeepScanClaimsStep,
} from "./steps";

export async function wheelTieredDeepScanWorkflow(
  input: TieredDeepScanWorkflowInput,
  telemetryContext: DurableTelemetryContext,
): Promise<TieredDeepScanWorkflowResult> {
  "use workflow";

  const telemetry = requireDurableTelemetryContext(telemetryContext);
  await recordTieredDeepScanWorkflowLifecycle(telemetry, "resumed");
  const prepared = await prepareMarketBatchStep({
    batchKey: input.batchKey,
    intervalStartedAt: input.intervalStartedAt,
    requests: input.requests,
  });
  const batchId = prepared.batch.batchId;

  try {
    if (!prepared.batch.created) {
      throw new Error(
        `Tiered coverage batch ${batchId} already exists with status ${prepared.batch.status}.`,
      );
    }

    const symbols = Array.from(
      new Set(input.claims.map((claim) => claim.symbol)),
    );
    const underlyingStage = await stageMarketBatchUnderlyingsStep(
      batchId,
      symbols,
    );
    await heartbeatTieredDeepScanStep(input);
    const optionStages = await Promise.all(
      optionUnitsForDeepScanClaims(
        underlyingStage.selectedSymbols,
        prepared.optionTypes,
        input.claims,
      ).map(({ optionType, symbol }) =>
        stageMarketBatchOptionStep(
          batchId,
          symbol,
          optionType,
          prepared.discoveryFilters,
        )
      ),
    );
    const ingestion = await finalizeTieredDeepScanFactsStep(
      batchId,
      underlyingStage,
      optionStages,
    );
    await heartbeatTieredDeepScanStep(input);
    const compatibility =
      await publishTieredDeepScanCompatibilityStep({
        batchId,
        claims: input.claims,
        leaseSeconds: input.leaseSeconds,
        optionStages,
        ownerId: input.ownerId,
        requests: prepared.requests,
      });
    const results = await resultsForTieredDeepScanClaimsStep(
      input.claims,
      optionStages,
    );
    const completion = await completeTieredDeepScanStep({
      batchId,
      ownerId: input.ownerId,
      results,
    });
    await recordTieredDeepScanWorkflowLifecycle(telemetry, "completed");

    return {
      batchId,
      compatibility,
      completedCount: completion.completed_count + completion.replayed_count,
      errorCount: ingestion.errorCount,
      optionContractCount: ingestion.optionContractCount,
      status: "complete",
      workCount: results.length,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Tiered deep scan failed.";
    await failTieredDeepScanStep({
      batchId,
      claims: input.claims,
      error: message,
      ownerId: input.ownerId,
    });
    await recordTieredDeepScanWorkflowLifecycle(telemetry, "failed");
    throw error;
  }
}
