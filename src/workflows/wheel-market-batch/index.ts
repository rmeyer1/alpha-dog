import type {
  SharedMarketBatchWorkflowInput,
  SharedMarketBatchWorkflowResult,
} from "@/lib/wheel/market-batch/model";
import type { DurableTelemetryContext } from "@/lib/observability/context";
import {
  completeLegacyMarketBatchSnapshotStep,
  failMarketBatchStep,
  finalizeMarketBatchFactsStep,
  finishMarketBatchStep,
  prepareMarketBatchStep,
  publishMarketBatchSnapshotStep,
  recordMarketBatchParityObservationStep,
  recordMarketBatchWorkflowLifecycle,
  stageMarketBatchConsumerStep,
  stageMarketBatchOptionStep,
  stageMarketBatchUnderlyingsStep,
} from "./steps";

export async function wheelMarketBatchWorkflow(
  input: SharedMarketBatchWorkflowInput,
  _telemetryContext?: DurableTelemetryContext,
): Promise<SharedMarketBatchWorkflowResult> {
  "use workflow";

  if (_telemetryContext) {
    await recordMarketBatchWorkflowLifecycle(_telemetryContext, "resumed");
  }
  console.info("[wheelMarketBatch] START", {
    intervalStartedAt: input.intervalStartedAt,
    requestCount: input.requests.length,
  });
  const prepared = await prepareMarketBatchStep(input);
  const batchId = prepared.batch.batchId;

  if (!prepared.batch.created) {
    console.info("[wheelMarketBatch] DEDUPLICATED", {
      batchId,
      canonicalStatus: prepared.batch.status,
    });

    return {
      batchId,
      canonicalStatus: prepared.batch.status,
      status: "deduplicated",
    };
  }

  try {
    const underlyingStage = await stageMarketBatchUnderlyingsStep(batchId);
    const optionStages = await Promise.all(
      underlyingStage.selectedSymbols.flatMap((symbol) =>
        prepared.optionTypes.map((optionType) =>
          stageMarketBatchOptionStep(
            batchId,
            symbol,
            optionType,
            prepared.discoveryFilters,
          )
        )
      ),
    );
    const ingestion = await finalizeMarketBatchFactsStep(
      batchId,
      underlyingStage,
      optionStages,
    );
    const stagedConsumers = await Promise.all(
      prepared.requests.map((request) =>
        stageMarketBatchConsumerStep(batchId, request)
      ),
    );
    const publications = await Promise.all(
      stagedConsumers.map(({ replacement }) =>
        publishMarketBatchSnapshotStep(replacement)
      ),
    );
    await Promise.all(
      stagedConsumers.map(({ legacy }) =>
        completeLegacyMarketBatchSnapshotStep(legacy)
      ),
    );
    await Promise.all(
      stagedConsumers.map(({ parity }, index) =>
        recordMarketBatchParityObservationStep(
          batchId,
          parity,
          prepared.requests[index],
          input.intervalStartedAt,
        )
      ),
    );
    await finishMarketBatchStep(
      batchId,
      stagedConsumers.length,
      stagedConsumers.reduce(
        (total, { replacement }) =>
          total + replacement.candidateCount,
        0,
      ),
      stagedConsumers.reduce(
        (total, { replacement }) => total + replacement.durationMs,
        0,
      ),
      publications.reduce(
        (total, publication) => total + publication.durationMs,
        0,
      ),
    );
    const snapshots = stagedConsumers.map(({ replacement }, index) => ({
      candidateCount: replacement.candidateCount,
      persona: prepared.requests[index].persona,
      snapshotId: replacement.snapshotId,
      strategy: prepared.requests[index].strategy,
    }));

    console.info("[wheelMarketBatch] DONE", {
      batchId,
      snapshotCount: snapshots.length,
    });
    if (_telemetryContext) {
      await recordMarketBatchWorkflowLifecycle(
        _telemetryContext,
        "completed",
      );
    }

    return {
      batchId,
      ingestion: {
        assetCount: ingestion.assetCount,
        errorCount: ingestion.errorCount,
        errors: ingestion.errors,
        optionContractCount: ingestion.optionContractCount,
        rankedCount: ingestion.rankedCount,
        selectedCount: ingestion.selectedCount,
      },
      snapshots,
      status: "complete",
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Market batch workflow failed.";
    await failMarketBatchStep(batchId, message);
    if (_telemetryContext) {
      await recordMarketBatchWorkflowLifecycle(_telemetryContext, "failed");
    }
    console.error("[wheelMarketBatch] FAIL", { batchId, message });
    throw error;
  }
}
