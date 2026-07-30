import { getEnv } from "@/lib/env";
import type { DurableTelemetryContext } from "@/lib/observability/context";
import {
  emitWorkflowTelemetry,
  runWithDurableTelemetryContext,
} from "@/lib/observability/workflow";
import {
  completeMaterializedWheelScreenerSnapshotSummary,
  createMaterializedWheelScreenerSnapshot,
  upsertMaterializedWheelScreenerCandidates,
} from "@/lib/wheel/materialized-screener";
import {
  marketBatchOptionTypes,
  marketBatchRequestIdentity,
} from "@/lib/wheel/market-batch/domain";
import {
  finalizeSharedMarketBatchFacts,
  finishSharedMarketBatch,
  markSharedMarketBatchFailed,
  prepareSharedMarketBatch,
  publishScoredMarketBatchSnapshot,
  sharedMarketBatchDiscoveryFilters,
  scoreSharedMarketBatchConsumerProjections,
  stageScoredMarketBatchSnapshotProjection,
  stageSharedMarketBatchOptions,
  stageSharedMarketBatchUnderlyings,
} from "@/lib/wheel/market-batch/service";
import type { ScannerParityResult } from "@/lib/wheel/scanner-parity";
import type {
  MarketBatchOptionStageSummary,
  MarketBatchUnderlyingStageSummary,
  SharedMarketBatchWorkflowInput,
  StagedLegacyMarketBatchSnapshot,
  StagedMarketBatchConsumerSnapshots,
  StagedMarketBatchSnapshot,
} from "@/lib/wheel/market-batch/model";

function logStep(
  step: string,
  phase: "START" | "DONE" | "FAIL",
  details: Record<string, unknown>,
) {
  const method = phase === "FAIL" ? console.error : console.info;
  method(`[wheelMarketBatch:${step}] ${phase}`, details);
}

export async function prepareMarketBatchStep(
  input: SharedMarketBatchWorkflowInput,
) {
  "use step";

  logStep("prepare", "START", {
    intervalStartedAt: input.intervalStartedAt,
    requestCount: input.requests.length,
  });

  try {
    const byIdentity = new Map(
      input.requests.map((request) => [
        JSON.stringify(marketBatchRequestIdentity(request)),
        request,
      ]),
    );
    const requests = Array.from(byIdentity.values());

    if (requests.length === 0) {
      throw new Error("A shared market batch requires scoring consumers.");
    }

    const feed = getEnv().ALPACA_OPTIONS_FEED;
    const batch = await prepareSharedMarketBatch({
      batchKey: input.batchKey,
      feed,
      intervalStartedAt: input.intervalStartedAt,
    });
    const result = {
      batch,
      discoveryFilters: sharedMarketBatchDiscoveryFilters(requests),
      optionTypes: marketBatchOptionTypes(requests),
      requests,
    };

    logStep("prepare", "DONE", {
      batchId: batch.batchId,
      created: batch.created,
      requestCount: requests.length,
    });

    return result;
  } catch (error) {
    logStep("prepare", "FAIL", {
      message: error instanceof Error ? error.message : "prepare failed",
    });
    throw error;
  }
}

export async function stageMarketBatchUnderlyingsStep(
  batchId: string,
  requestedSymbols?: string[],
) {
  "use step";

  logStep("underlyings", "START", { batchId });

  try {
    const result = await stageSharedMarketBatchUnderlyings(
      batchId,
      requestedSymbols,
    );
    logStep("underlyings", "DONE", {
      batchId,
      selectedCount: result.selectedCount,
    });
    return result;
  } catch (error) {
    logStep("underlyings", "FAIL", {
      batchId,
      message: error instanceof Error ? error.message : "underlyings failed",
    });
    throw error;
  }
}

export async function stageMarketBatchOptionStep(
  batchId: string,
  symbol: string,
  optionType: "put" | "call",
  filters: Parameters<typeof stageSharedMarketBatchOptions>[0]["filters"],
) {
  "use step";

  logStep("option", "START", { batchId, optionType, symbol });
  const result = await stageSharedMarketBatchOptions({
    batchId,
    filters,
    optionType,
    symbol,
  });
  logStep("option", "DONE", {
    batchId,
    contractCount: result.contractCount,
    error: result.error != null,
    optionType,
    symbol,
  });

  return result;
}

export async function finalizeMarketBatchFactsStep(
  batchId: string,
  underlyingStage: MarketBatchUnderlyingStageSummary,
  optionStages: MarketBatchOptionStageSummary[],
) {
  "use step";

  logStep("facts", "START", {
    batchId,
    optionStageCount: optionStages.length,
  });

  try {
    const result = await finalizeSharedMarketBatchFacts({
      batchId,
      optionStages,
      underlyingStage,
    });
    logStep("facts", "DONE", {
      batchId,
      errorCount: result.errorCount,
      optionContractCount: result.optionContractCount,
    });
    return result;
  } catch (error) {
    logStep("facts", "FAIL", {
      batchId,
      message: error instanceof Error ? error.message : "facts failed",
    });
    throw error;
  }
}

export async function stageMarketBatchConsumerStep(
  batchId: string,
  request: SharedMarketBatchWorkflowInput["requests"][number],
): Promise<StagedMarketBatchConsumerSnapshots & { parity: ScannerParityResult }> {
  "use step";

  logStep("score", "START", {
    batchId,
    persona: request.persona,
    strategy: request.strategy,
  });

  try {
    const { batch, parity, projections } =
      await scoreSharedMarketBatchConsumerProjections(batchId, request);
    const replacement = await stageScoredMarketBatchSnapshotProjection(
      batchId,
      request,
      batch.feed,
      projections.replacement,
    );
    const snapshotId = await createMaterializedWheelScreenerSnapshot(request);

    if (!snapshotId) {
      throw new Error(
        "Legacy-compatible market batch snapshot was not created.",
      );
    }

    await upsertMaterializedWheelScreenerCandidates(
      snapshotId,
      request,
      projections.legacy.response,
    );
    const legacy: StagedLegacyMarketBatchSnapshot = {
      error: projections.legacy.response.errors[0] ?? null,
      processedCount:
        projections.legacy.response.progress.processedCount,
      skippedCount: projections.legacy.response.skippedCount,
      snapshotId,
      totalCount: projections.legacy.response.progress.totalCount,
    };

    logStep("score", "DONE", {
      batchId,
      legacyCandidateCount: projections.legacy.companies.length,
      legacySnapshotId: legacy.snapshotId,
      replacementCandidateCount: replacement.candidateCount,
      replacementSnapshotId: replacement.snapshotId,
    });
    return { legacy, parity, replacement };
  } catch (error) {
    logStep("score", "FAIL", {
      batchId,
      message: error instanceof Error ? error.message : "scoring failed",
    });
    throw error;
  }
}

export async function publishMarketBatchSnapshotStep(
  snapshot: StagedMarketBatchSnapshot,
) {
  "use step";

  logStep("publish", "START", { snapshotId: snapshot.snapshotId });

  try {
    const result = await publishScoredMarketBatchSnapshot(snapshot);
    logStep("publish", "DONE", {
      snapshotId: snapshot.snapshotId,
      staged: result.staged,
    });
    return result;
  } catch (error) {
    logStep("publish", "FAIL", {
      message: error instanceof Error ? error.message : "publication failed",
      snapshotId: snapshot.snapshotId,
    });
    throw error;
  }
}

export async function completeLegacyMarketBatchSnapshotStep(
  snapshot: StagedLegacyMarketBatchSnapshot,
) {
  "use step";

  await completeMaterializedWheelScreenerSnapshotSummary(
    snapshot.snapshotId,
    snapshot,
  );
  logStep("legacy-complete", "DONE", {
    snapshotId: snapshot.snapshotId,
  });
}

export async function recordMarketBatchWorkflowLifecycle(
  telemetryContext: DurableTelemetryContext,
  phase: "completed" | "failed" | "resumed",
) {
  "use step";

  await runWithDurableTelemetryContext(telemetryContext, (normalized) =>
    emitWorkflowTelemetry({
      context: normalized,
      phase,
      workflow: "wheel_market_batch",
    })
  );
}

export async function finishMarketBatchStep(
  batchId: string,
  snapshotCount: number,
  candidateRowsWritten: number,
  scoringDurationMs: number,
  publicationDurationMs: number,
) {
  "use step";

  logStep("finish", "START", { batchId, snapshotCount });
  await finishSharedMarketBatch({
    batchId,
    candidateRowsWritten,
    publicationDurationMs,
    scoringDurationMs,
    snapshotCount,
  });
  logStep("finish", "DONE", { batchId, snapshotCount });
}

export async function failMarketBatchStep(
  batchId: string,
  message: string,
) {
  "use step";

  logStep("fail", "START", { batchId });
  await markSharedMarketBatchFailed(batchId, new Error(message));
  logStep("fail", "DONE", { batchId });
}
