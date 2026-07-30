import { beforeEach, describe, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => vi.fn(() => ({
  ALPACA_OPTIONS_FEED: "opra",
})));
const domainMocks = vi.hoisted(() => ({
  marketBatchOptionTypes: vi.fn(() => ["put"]),
  marketBatchRequestIdentity: vi.fn((request) => ({
    filterKey: request.strategy,
    filters: { dteMin: 7, dteMax: 45 },
    persona: request.persona,
    strategy: request.strategy,
  })),
}));
const serviceMocks = vi.hoisted(() => ({
  finalize: vi.fn(),
  finish: vi.fn(),
  markFailed: vi.fn(),
  prepare: vi.fn(),
  publish: vi.fn(),
  scoreProjections: vi.fn(),
  sharedFilters: vi.fn(() => ({ dteMin: 7, dteMax: 45 })),
  stageOptions: vi.fn(),
  stageProjection: vi.fn(),
  stageUnderlyings: vi.fn(),
}));
const materializedMocks = vi.hoisted(() => ({
  completeSummary: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
}));
const observabilityMocks = vi.hoisted(() => ({
  emit: vi.fn(),
  run: vi.fn((_context, callback) => callback(_context)),
}));

vi.mock("@/lib/env", () => ({ getEnv: envMock }));
vi.mock("@/lib/wheel/market-batch/domain", () => domainMocks);
vi.mock("@/lib/wheel/market-batch/service", () => ({
  finalizeSharedMarketBatchFacts: serviceMocks.finalize,
  finishSharedMarketBatch: serviceMocks.finish,
  markSharedMarketBatchFailed: serviceMocks.markFailed,
  prepareSharedMarketBatch: serviceMocks.prepare,
  publishScoredMarketBatchSnapshot: serviceMocks.publish,
  scoreSharedMarketBatchConsumerProjections: serviceMocks.scoreProjections,
  sharedMarketBatchDiscoveryFilters: serviceMocks.sharedFilters,
  stageScoredMarketBatchSnapshotProjection: serviceMocks.stageProjection,
  stageSharedMarketBatchOptions: serviceMocks.stageOptions,
  stageSharedMarketBatchUnderlyings: serviceMocks.stageUnderlyings,
}));
vi.mock("@/lib/wheel/materialized-screener", () => ({
  completeMaterializedWheelScreenerSnapshotSummary:
    materializedMocks.completeSummary,
  createMaterializedWheelScreenerSnapshot: materializedMocks.create,
  upsertMaterializedWheelScreenerCandidates: materializedMocks.upsert,
}));
vi.mock("@/lib/observability/workflow", () => ({
  emitWorkflowTelemetry: observabilityMocks.emit,
  runWithDurableTelemetryContext: observabilityMocks.run,
}));

const input = {
  intervalStartedAt: "2026-07-27T14:00:00.000Z",
  requests: [{
    persona: "balanced_wheel" as const,
    strategy: "short_put" as const,
  }],
};
const underlyingStage = {
  assetCount: 1,
  metrics: [],
  missingSymbols: [],
  rankedCount: 1,
  selectedCount: 1,
  selectedSymbols: ["AAPL"],
};
const optionStage = {
  contractCount: 1,
  durationMs: 2,
  error: null,
  optionType: "put" as const,
  providerRequests: 1,
  symbol: "AAPL",
};
const snapshot = {
  candidateCount: 1,
  durationMs: 3,
  errors: [],
  screenedCount: 1,
  skippedCount: 0,
  snapshotId: "snapshot-1",
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  serviceMocks.prepare.mockResolvedValue({
    batchId: "batch-1",
    batchKey: "key",
    created: true,
    status: "running",
  });
  serviceMocks.stageUnderlyings.mockResolvedValue(underlyingStage);
  serviceMocks.stageOptions.mockResolvedValue(optionStage);
  serviceMocks.finalize.mockResolvedValue({
    assetCount: 1,
    errorCount: 0,
    errors: [],
    metrics: [],
    optionContractCount: 1,
    rankedCount: 1,
    selectedCount: 1,
  });
  serviceMocks.stageProjection.mockResolvedValue(snapshot);
  serviceMocks.publish.mockResolvedValue({ staged: true, durationMs: 1 });
  serviceMocks.scoreProjections.mockResolvedValue({
    batch: { feed: "opra" },
    parity: {
      candidateCount: { legacy: 1, replacement: 1 },
      exactMatch: false,
      formatVersion: 1,
      mismatchCount: 1,
      mismatches: {
        eligibility: 0,
        financial: 0,
        ordering: 0,
        score: 1,
        warning: 0,
      },
      samples: [],
    },
    projections: {
      legacy: {
        companies: [{ ticker: "LEGACY" }],
        response: {
          companies: [{ ticker: "LEGACY" }],
          errors: ["legacy-only"],
          progress: { processedCount: 1, totalCount: 2 },
          skippedCount: 1,
          warnings: [],
        },
      },
      replacement: {
        companies: [{ ticker: "REPLACEMENT" }],
        response: {
          companies: [{ ticker: "REPLACEMENT" }],
          errors: [],
          progress: { processedCount: 2, totalCount: 2 },
          skippedCount: 0,
          warnings: [],
        },
      },
    },
  });
  materializedMocks.create.mockResolvedValue("legacy-snapshot-1");
});

describe("wheel market batch workflow steps", () => {
  it("runs once and persists the independent legacy projection under a forced mismatch", async () => {
    const steps = await import("./steps");
    const prepared = await steps.prepareMarketBatchStep({
      ...input,
      requests: [input.requests[0], input.requests[0]],
    });

    expect(prepared.requests).toHaveLength(1);
    expect(serviceMocks.prepare).toHaveBeenCalledWith({
      batchKey: undefined,
      feed: "opra",
      intervalStartedAt: input.intervalStartedAt,
    });
    await expect(
      steps.stageMarketBatchUnderlyingsStep("batch-1"),
    ).resolves.toEqual(underlyingStage);
    await expect(steps.stageMarketBatchOptionStep(
      "batch-1",
      "AAPL",
      "put",
      {} as never,
    )).resolves.toEqual(optionStage);
    serviceMocks.stageOptions.mockResolvedValueOnce({
      ...optionStage,
      contractCount: 0,
      error: "timeout",
    });
    await steps.stageMarketBatchOptionStep(
      "batch-1",
      "AAPL",
      "put",
      {} as never,
    );
    await expect(steps.finalizeMarketBatchFactsStep(
      "batch-1",
      underlyingStage,
      [optionStage],
    )).resolves.toMatchObject({ optionContractCount: 1 });
    await expect(
      steps.stageMarketBatchConsumerStep("batch-1", input.requests[0]),
    ).resolves.toEqual({
      legacy: {
        error: "legacy-only",
        processedCount: 1,
        skippedCount: 1,
        snapshotId: "legacy-snapshot-1",
        totalCount: 2,
      },
      parity: expect.objectContaining({ exactMatch: false }),
      replacement: snapshot,
    });
    await expect(
      steps.publishMarketBatchSnapshotStep(snapshot),
    ).resolves.toMatchObject({ staged: true });
    await steps.completeLegacyMarketBatchSnapshotStep(
      {
        error: "legacy-only",
        processedCount: 1,
        skippedCount: 1,
        snapshotId: "legacy-snapshot-1",
        totalCount: 2,
      },
    );
    await steps.recordMarketBatchWorkflowLifecycle(
      {
        correlationId: "correlation-1",
        logicalOperationId: "logical-1",
        startedAtEpochMs: 1,
      },
      "completed",
    );
    await steps.finishMarketBatchStep("batch-1", 1, 1, 3, 1);
    await steps.failMarketBatchStep("batch-1", "failed");

    expect(serviceMocks.finish).toHaveBeenCalledOnce();
    expect(serviceMocks.markFailed).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ message: "failed" }),
    );
    expect(materializedMocks.upsert).toHaveBeenCalledWith(
      "legacy-snapshot-1",
      input.requests[0],
      expect.objectContaining({
        companies: [{ ticker: "LEGACY" }],
        errors: ["legacy-only"],
      }),
    );
    expect(materializedMocks.upsert).not.toHaveBeenCalledWith(
      "legacy-snapshot-1",
      input.requests[0],
      expect.objectContaining({
        companies: [{ ticker: "REPLACEMENT" }],
      }),
    );
    expect(materializedMocks.completeSummary).toHaveBeenCalledWith(
      "legacy-snapshot-1",
      expect.objectContaining({
        error: "legacy-only",
        processedCount: 1,
        skippedCount: 1,
        totalCount: 2,
      }),
    );
    expect(serviceMocks.scoreProjections).toHaveBeenCalledOnce();
    expect(serviceMocks.stageProjection).toHaveBeenCalledOnce();
    expect(observabilityMocks.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "completed",
        workflow: "wheel_market_batch",
      }),
    );
  });

  it("fails before candidate publication when a legacy snapshot is not created", async () => {
    materializedMocks.create.mockResolvedValueOnce(null);
    const { stageMarketBatchConsumerStep } = await import("./steps");

    await expect(
      stageMarketBatchConsumerStep("batch-1", input.requests[0]),
    ).rejects.toThrow("was not created");
    expect(materializedMocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects an empty prepare request", async () => {
    const { prepareMarketBatchStep } = await import("./steps");

    await expect(prepareMarketBatchStep({
      ...input,
      requests: [],
    })).rejects.toThrow("requires scoring consumers");
    expect(console.error).toHaveBeenCalled();
  });

  it.each([
    ["prepare", () => import("./steps").then((steps) =>
      steps.prepareMarketBatchStep(input)), serviceMocks.prepare],
    ["underlyings", () => import("./steps").then((steps) =>
      steps.stageMarketBatchUnderlyingsStep("batch-1")),
    serviceMocks.stageUnderlyings],
    ["facts", () => import("./steps").then((steps) =>
      steps.finalizeMarketBatchFactsStep(
        "batch-1",
        underlyingStage,
        [optionStage],
      )), serviceMocks.finalize],
    ["score", () => import("./steps").then((steps) =>
      steps.stageMarketBatchConsumerStep("batch-1", input.requests[0])),
    serviceMocks.stageProjection],
    ["publish", () => import("./steps").then((steps) =>
      steps.publishMarketBatchSnapshotStep(snapshot)), serviceMocks.publish],
  ] as const)("logs and rethrows %s failures", async (_name, run, mock) => {
    mock.mockRejectedValueOnce(new Error("boom"));

    await expect(run()).rejects.toThrow("boom");
    expect(console.error).toHaveBeenCalled();
  });

  it("logs a stable fallback for a non-Error failure", async () => {
    const {
      finalizeMarketBatchFactsStep,
      publishMarketBatchSnapshotStep,
      stageMarketBatchConsumerStep,
    } = await import("./steps");
    serviceMocks.finalize.mockRejectedValueOnce("unknown");
    await expect(finalizeMarketBatchFactsStep(
      "batch-1",
      underlyingStage,
      [optionStage],
    )).rejects.toBe("unknown");
    expect(console.error).toHaveBeenCalledWith(
      "[wheelMarketBatch:facts] FAIL",
      expect.objectContaining({ message: "facts failed" }),
    );

    serviceMocks.stageProjection.mockRejectedValueOnce("unknown");
    await expect(
      stageMarketBatchConsumerStep("batch-1", input.requests[0]),
    ).rejects.toBe("unknown");
    expect(console.error).toHaveBeenCalledWith(
      "[wheelMarketBatch:score] FAIL",
      expect.objectContaining({ message: "scoring failed" }),
    );

    serviceMocks.publish.mockRejectedValueOnce("unknown");

    await expect(
      publishMarketBatchSnapshotStep(snapshot),
    ).rejects.toBe("unknown");
    expect(console.error).toHaveBeenCalledWith(
      "[wheelMarketBatch:publish] FAIL",
      expect.objectContaining({ message: "publication failed" }),
    );
  });
});
