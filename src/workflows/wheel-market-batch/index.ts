import type {
  SharedMarketBatchWorkflowInput,
  SharedMarketBatchWorkflowResult,
} from "@/lib/wheel/market-batch/model";
import {
  failMarketBatchStep,
  finalizeMarketBatchFactsStep,
  finishMarketBatchStep,
  prepareMarketBatchStep,
  publishMarketBatchSnapshotStep,
  stageMarketBatchOptionStep,
  stageMarketBatchSnapshotStep,
  stageMarketBatchUnderlyingsStep,
} from "./steps";

export async function wheelMarketBatchWorkflow(
  input: SharedMarketBatchWorkflowInput,
): Promise<SharedMarketBatchWorkflowResult> {
  "use workflow";

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
    const stagedSnapshots = await Promise.all(
      prepared.requests.map((request) =>
        stageMarketBatchSnapshotStep(batchId, request)
      ),
    );
    const publications = await Promise.all(
      stagedSnapshots.map((snapshot) =>
        publishMarketBatchSnapshotStep(snapshot)
      ),
    );
    await finishMarketBatchStep(
      batchId,
      stagedSnapshots.length,
      stagedSnapshots.reduce(
        (total, snapshot) => total + snapshot.candidateCount,
        0,
      ),
      stagedSnapshots.reduce(
        (total, snapshot) => total + snapshot.durationMs,
        0,
      ),
      publications.reduce(
        (total, publication) => total + publication.durationMs,
        0,
      ),
    );
    const snapshots = stagedSnapshots.map((snapshot, index) => ({
      candidateCount: snapshot.candidateCount,
      persona: prepared.requests[index].persona,
      snapshotId: snapshot.snapshotId,
      strategy: prepared.requests[index].strategy,
    }));

    console.info("[wheelMarketBatch] DONE", {
      batchId,
      snapshotCount: snapshots.length,
    });

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
    console.error("[wheelMarketBatch] FAIL", { batchId, message });
    throw error;
  }
}
