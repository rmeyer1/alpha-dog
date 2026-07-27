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
  sharedFilters: vi.fn(() => ({ dteMin: 7, dteMax: 45 })),
  stageOptions: vi.fn(),
  stageSnapshot: vi.fn(),
  stageUnderlyings: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getEnv: envMock }));
vi.mock("@/lib/wheel/market-batch/domain", () => domainMocks);
vi.mock("@/lib/wheel/market-batch/service", () => ({
  finalizeSharedMarketBatchFacts: serviceMocks.finalize,
  finishSharedMarketBatch: serviceMocks.finish,
  markSharedMarketBatchFailed: serviceMocks.markFailed,
  prepareSharedMarketBatch: serviceMocks.prepare,
  publishScoredMarketBatchSnapshot: serviceMocks.publish,
  sharedMarketBatchDiscoveryFilters: serviceMocks.sharedFilters,
  stageScoredMarketBatchSnapshot: serviceMocks.stageSnapshot,
  stageSharedMarketBatchOptions: serviceMocks.stageOptions,
  stageSharedMarketBatchUnderlyings: serviceMocks.stageUnderlyings,
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
  serviceMocks.stageSnapshot.mockResolvedValue(snapshot);
  serviceMocks.publish.mockResolvedValue({ staged: true, durationMs: 1 });
});

describe("wheel market batch workflow steps", () => {
  it("runs every successful step and deduplicates consumer identities", async () => {
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
      steps.stageMarketBatchSnapshotStep("batch-1", input.requests[0]),
    ).resolves.toEqual(snapshot);
    await expect(
      steps.publishMarketBatchSnapshotStep(snapshot),
    ).resolves.toMatchObject({ staged: true });
    await steps.finishMarketBatchStep("batch-1", 1, 1, 3, 1);
    await steps.failMarketBatchStep("batch-1", "failed");

    expect(serviceMocks.finish).toHaveBeenCalledOnce();
    expect(serviceMocks.markFailed).toHaveBeenCalledWith(
      "batch-1",
      expect.objectContaining({ message: "failed" }),
    );
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
      steps.stageMarketBatchSnapshotStep("batch-1", input.requests[0])),
    serviceMocks.stageSnapshot],
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
      stageMarketBatchSnapshotStep,
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

    serviceMocks.stageSnapshot.mockRejectedValueOnce("unknown");
    await expect(
      stageMarketBatchSnapshotStep("batch-1", input.requests[0]),
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
