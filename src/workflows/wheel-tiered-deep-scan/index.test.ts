import { beforeEach, describe, expect, it, vi } from "vitest";

const stepMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  fail: vi.fn(),
  finalize: vi.fn(),
  heartbeat: vi.fn(),
  lifecycle: vi.fn(),
  prepare: vi.fn(),
  publish: vi.fn(),
  results: vi.fn(),
  stageOption: vi.fn(),
  stageUnderlyings: vi.fn(),
}));

vi.mock("../wheel-market-batch/steps", () => ({
  prepareMarketBatchStep: stepMocks.prepare,
  stageMarketBatchOptionStep: stepMocks.stageOption,
  stageMarketBatchUnderlyingsStep: stepMocks.stageUnderlyings,
}));
vi.mock("./steps", () => ({
  completeTieredDeepScanStep: stepMocks.complete,
  failTieredDeepScanStep: stepMocks.fail,
  finalizeTieredDeepScanFactsStep: stepMocks.finalize,
  heartbeatTieredDeepScanStep: stepMocks.heartbeat,
  publishTieredDeepScanCompatibilityStep: stepMocks.publish,
  recordTieredDeepScanWorkflowLifecycle: stepMocks.lifecycle,
  resultsForTieredDeepScanClaimsStep: stepMocks.results,
}));

const input = {
  batchKey: "coverage:interval:owner",
  claims: [{
    attemptCount: 1,
    coverageTier: "priority" as const,
    leaseAcquiredAt: "2026-07-27T14:00:00.000Z",
    leaseExpiresAt: "2026-07-27T15:00:00.000Z",
    leaseOwnerId: "00000000-0000-4000-8000-000000000001",
    leaseToken: "00000000-0000-4000-8000-000000000002",
    nextDueAt: "2026-07-27T14:00:00.000Z",
    optionType: "put" as const,
    symbol: "AAPL",
    tierPriority: 1,
    tierRank: 1,
  }],
  intervalStartedAt: "2026-07-27T14:00:00.000Z",
  leaseSeconds: 3600,
  ownerId: "00000000-0000-4000-8000-000000000001",
  requests: [{
    persona: "balanced_wheel" as const,
    strategy: "short_put" as const,
  }],
};
const telemetry = {
  correlationId: "correlation-1",
  logicalOperationId: "operation-1",
  startedAtEpochMs: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  stepMocks.prepare.mockResolvedValue({
    batch: {
      batchId: "batch-1",
      created: true,
      status: "running",
    },
    discoveryFilters: {},
    optionTypes: ["put"],
    requests: input.requests,
  });
  stepMocks.stageUnderlyings.mockResolvedValue({
    assetCount: 1,
    metrics: [],
    missingSymbols: [],
    rankedCount: 1,
    selectedCount: 1,
    selectedSymbols: ["AAPL"],
  });
  stepMocks.stageOption.mockResolvedValue({
    contractCount: 2,
    durationMs: 1,
    error: null,
    optionType: "put",
    providerRequests: 1,
    symbol: "AAPL",
  });
  stepMocks.finalize.mockResolvedValue({
    errorCount: 0,
    optionContractCount: 2,
  });
  stepMocks.publish.mockResolvedValue({
    candidateCount: 1,
    consumerCount: 1,
    coverageRowCount: 1,
  });
  stepMocks.complete.mockResolvedValue({
    completed_count: 1,
    replayed_count: 0,
  });
  stepMocks.results.mockReturnValue([{
    error: null,
    leaseToken: input.claims[0].leaseToken,
    optionContractCount: 2,
    optionType: "put",
    outcome: "complete",
    symbol: "AAPL",
  }]);
});

describe("tiered deep scan workflow", () => {
  it("fetches shared facts once and atomically completes claimed work", async () => {
    const { wheelTieredDeepScanWorkflow } = await import("./index");

    await expect(
      wheelTieredDeepScanWorkflow(input, telemetry),
    ).resolves.toMatchObject({
      batchId: "batch-1",
      completedCount: 1,
      status: "complete",
      workCount: 1,
    });
    expect(stepMocks.stageUnderlyings).toHaveBeenCalledWith(
      "batch-1",
      ["AAPL"],
    );
    expect(stepMocks.stageOption).toHaveBeenCalledTimes(1);
    expect(stepMocks.heartbeat).toHaveBeenCalledTimes(2);
    expect(stepMocks.complete).toHaveBeenCalledOnce();
    expect(stepMocks.fail).not.toHaveBeenCalled();
  });

  it("fails the batch and releases owned work when publication fails", async () => {
    const { wheelTieredDeepScanWorkflow } = await import("./index");
    stepMocks.publish.mockRejectedValueOnce(new Error("compatibility failed"));

    await expect(
      wheelTieredDeepScanWorkflow(input, telemetry),
    ).rejects.toThrow("compatibility failed");
    expect(stepMocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId: "batch-1",
        error: "compatibility failed",
      }),
    );
  });

  it("rejects a non-created canonical batch and records failure", async () => {
    const { wheelTieredDeepScanWorkflow } = await import("./index");
    stepMocks.prepare.mockResolvedValueOnce({
      batch: {
        batchId: "batch-existing",
        created: false,
        status: "running",
      },
      discoveryFilters: {},
      optionTypes: ["put"],
      requests: input.requests,
    });

    await expect(
      wheelTieredDeepScanWorkflow(input, telemetry),
    ).rejects.toThrow("already exists");
    expect(stepMocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({ batchId: "batch-existing" }),
    );
  });

  it("normalizes non-Error failures at the durable failure boundary", async () => {
    const { wheelTieredDeepScanWorkflow } = await import("./index");
    stepMocks.publish.mockRejectedValueOnce("provider exploded");

    await expect(
      wheelTieredDeepScanWorkflow(input, telemetry),
    ).rejects.toBe("provider exploded");
    expect(stepMocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Tiered deep scan failed." }),
    );
  });
});
