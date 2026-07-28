import { beforeEach, describe, expect, it, vi } from "vitest";

const workMocks = vi.hoisted(() => ({
  complete: vi.fn(),
  fail: vi.fn(),
  heartbeat: vi.fn(),
}));
const compatibilityMock = vi.hoisted(() => vi.fn());
const finalizeMock = vi.hoisted(() => vi.fn());
const observabilityMocks = vi.hoisted(() => ({
  emit: vi.fn(),
  run: vi.fn(async (
    context: unknown,
    callback: (value: unknown) => Promise<unknown>,
  ) => callback(context)),
}));

vi.mock("@/lib/wheel/deep-scan-work/repository", () => ({
  completeDeepScanWorkBatch: workMocks.complete,
  failDeepScanWorkBatch: workMocks.fail,
  heartbeatDeepScanWork: workMocks.heartbeat,
}));
vi.mock("@/lib/wheel/deep-scan-work/service", () => ({
  publishTieredDeepScanCompatibility: compatibilityMock,
}));
vi.mock("@/lib/wheel/market-batch/service", () => ({
  finalizeSharedMarketCoverageFacts: finalizeMock,
}));
vi.mock("@/lib/observability/workflow", () => ({
  emitWorkflowTelemetry: observabilityMocks.emit,
  runWithDurableTelemetryContext: observabilityMocks.run,
}));

const claim = {
  attemptCount: 1,
  coverageTier: "priority" as const,
  leaseAcquiredAt: "2026-07-27T14:00:00.000Z",
  leaseExpiresAt: "2026-07-27T15:00:00.000Z",
  leaseOwnerId: "owner",
  leaseToken: "token",
  nextDueAt: "2026-07-27T14:00:00.000Z",
  optionType: "put" as const,
  symbol: "AAPL",
  tierPriority: 1,
  tierRank: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tiered deep scan workflow steps", () => {
  it("maps every durable boundary to its service operation", async () => {
    const steps = await import("./steps");
    const owner = "00000000-0000-4000-8000-000000000001";
    const stage = {
      contractCount: 1,
      durationMs: 1,
      error: null,
      optionType: "put" as const,
      providerRequests: 1,
      symbol: "AAPL",
    };
    const underlying = {
      assetCount: 1,
      metrics: [],
      missingSymbols: [],
      rankedCount: 1,
      selectedCount: 1,
      selectedSymbols: ["AAPL"],
    };

    await steps.recordTieredDeepScanWorkflowLifecycle(
      {
        correlationId: "correlation-1",
        logicalOperationId: "operation-1",
        startedAtEpochMs: 1,
      },
      "resumed",
    );
    await steps.heartbeatTieredDeepScanStep({
      claims: [claim],
      leaseSeconds: 3600,
      ownerId: owner,
    });
    await expect(
      steps.resultsForTieredDeepScanClaimsStep([claim], [stage]),
    ).resolves.toEqual([
      expect.objectContaining({ outcome: "complete", symbol: "AAPL" }),
    ]);
    await steps.finalizeTieredDeepScanFactsStep(
      "batch-1",
      underlying,
      [stage],
    );
    await steps.publishTieredDeepScanCompatibilityStep({
      batchId: "batch-1",
      claims: [claim],
      leaseSeconds: 3600,
      optionStages: [stage],
      ownerId: owner,
      requests: [{
        persona: "balanced_wheel",
        strategy: "short_put",
      }],
    });
    await steps.completeTieredDeepScanStep({
      batchId: "batch-1",
      ownerId: owner,
      results: [{
        error: null,
        leaseToken: "token",
        optionContractCount: 1,
        optionType: "put",
        outcome: "complete",
        symbol: "AAPL",
      }],
    });
    await steps.failTieredDeepScanStep({
      batchId: "batch-1",
      claims: [claim],
      error: "failed",
      ownerId: owner,
    });

    expect(workMocks.heartbeat).toHaveBeenCalledOnce();
    expect(observabilityMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "resumed",
        workflow: "wheel_deep_scan",
      }),
    );
    expect(finalizeMock).toHaveBeenCalledOnce();
    expect(compatibilityMock).toHaveBeenCalledOnce();
    expect(workMocks.complete).toHaveBeenCalledOnce();
    expect(workMocks.fail).toHaveBeenCalledOnce();
  });
});
