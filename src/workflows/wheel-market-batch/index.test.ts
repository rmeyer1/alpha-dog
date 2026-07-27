import { beforeEach, describe, expect, it, vi } from "vitest";

const stepMocks = vi.hoisted(() => ({
  fail: vi.fn(),
  finalizeFacts: vi.fn(),
  finish: vi.fn(),
  prepare: vi.fn(),
  publish: vi.fn(),
  score: vi.fn(),
  stageOption: vi.fn(),
  stageUnderlyings: vi.fn(),
}));

vi.mock("./steps", () => ({
  failMarketBatchStep: stepMocks.fail,
  finalizeMarketBatchFactsStep: stepMocks.finalizeFacts,
  finishMarketBatchStep: stepMocks.finish,
  prepareMarketBatchStep: stepMocks.prepare,
  publishMarketBatchSnapshotStep: stepMocks.publish,
  stageMarketBatchOptionStep: stepMocks.stageOption,
  stageMarketBatchSnapshotStep: stepMocks.score,
  stageMarketBatchUnderlyingsStep: stepMocks.stageUnderlyings,
}));

const requests = [
  { persona: "balanced_wheel" as const, strategy: "short_put" as const },
  { persona: "balanced_wheel" as const, strategy: "covered_call" as const },
];

beforeEach(() => {
  vi.clearAllMocks();
  stepMocks.prepare.mockResolvedValue({
    batch: {
      batchId: "batch-1",
      batchKey: "batch-key",
      created: true,
      status: "running",
    },
    discoveryFilters: { dteMin: 7, dteMax: 45 },
    optionTypes: ["put", "call"],
    requests,
  });
  stepMocks.stageUnderlyings.mockResolvedValue({
    assetCount: 1,
    metrics: [],
    rankedCount: 1,
    selectedCount: 1,
    selectedSymbols: ["AAPL"],
  });
  stepMocks.stageOption
    .mockResolvedValueOnce({
      contractCount: 2,
      durationMs: 10,
      error: null,
      optionType: "put",
      providerRequests: 1,
      symbol: "AAPL",
    })
    .mockResolvedValueOnce({
      contractCount: 2,
      durationMs: 12,
      error: null,
      optionType: "call",
      providerRequests: 1,
      symbol: "AAPL",
    });
  stepMocks.finalizeFacts.mockResolvedValue({
    assetCount: 1,
    errorCount: 0,
    errors: [],
    metrics: [],
    optionContractCount: 4,
    rankedCount: 1,
    selectedCount: 1,
  });
  stepMocks.score
    .mockResolvedValueOnce({
      candidateCount: 1,
      durationMs: 4,
      errors: [],
      screenedCount: 1,
      skippedCount: 0,
      snapshotId: "snapshot-put",
      warnings: [],
    })
    .mockResolvedValueOnce({
      candidateCount: 1,
      durationMs: 6,
      errors: [],
      screenedCount: 1,
      skippedCount: 0,
      snapshotId: "snapshot-call",
      warnings: [],
    });
  stepMocks.publish
    .mockResolvedValueOnce({ durationMs: 2, published: true })
    .mockResolvedValueOnce({ durationMs: 3, published: true });
});

describe("wheel market batch workflow", () => {
  it("fans shared facts into consumers while passing only identifiers", async () => {
    const { wheelMarketBatchWorkflow } = await import("./index");
    const result = await wheelMarketBatchWorkflow({
      intervalStartedAt: "2026-07-27T14:00:00.000Z",
      requests,
    });

    expect(stepMocks.stageUnderlyings).toHaveBeenCalledWith("batch-1");
    expect(stepMocks.stageOption.mock.calls).toEqual([
      ["batch-1", "AAPL", "put", { dteMin: 7, dteMax: 45 }],
      ["batch-1", "AAPL", "call", { dteMin: 7, dteMax: 45 }],
    ]);
    expect(stepMocks.score.mock.calls).toEqual([
      ["batch-1", requests[0]],
      ["batch-1", requests[1]],
    ]);
    expect(stepMocks.finish).toHaveBeenCalledWith("batch-1", 2, 2, 10, 5);
    expect(result).toMatchObject({
      batchId: "batch-1",
      status: "complete",
      snapshots: [
        { snapshotId: "snapshot-put", strategy: "short_put" },
        { snapshotId: "snapshot-call", strategy: "covered_call" },
      ],
    });
  });

  it("records a failed batch without publishing incomplete snapshots", async () => {
    stepMocks.finalizeFacts.mockRejectedValueOnce(
      new Error("all option providers failed"),
    );
    const { wheelMarketBatchWorkflow } = await import("./index");

    await expect(
      wheelMarketBatchWorkflow({
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      }),
    ).rejects.toThrow("all option providers failed");
    expect(stepMocks.score).not.toHaveBeenCalled();
    expect(stepMocks.publish).not.toHaveBeenCalled();
    expect(stepMocks.fail).toHaveBeenCalledWith(
      "batch-1",
      "all option providers failed",
    );
  });

  it("joins the canonical batch without repeating provider ingestion", async () => {
    stepMocks.prepare.mockResolvedValueOnce({
      batch: {
        batchId: "batch-1",
        batchKey: "batch-key",
        created: false,
        status: "running",
      },
      discoveryFilters: { dteMin: 7, dteMax: 45 },
      optionTypes: ["put", "call"],
      requests,
    });
    const { wheelMarketBatchWorkflow } = await import("./index");

    await expect(
      wheelMarketBatchWorkflow({
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      }),
    ).resolves.toEqual({
      batchId: "batch-1",
      canonicalStatus: "running",
      status: "deduplicated",
    });
    expect(stepMocks.stageUnderlyings).not.toHaveBeenCalled();
    expect(stepMocks.stageOption).not.toHaveBeenCalled();
    expect(stepMocks.score).not.toHaveBeenCalled();
    expect(stepMocks.publish).not.toHaveBeenCalled();
    expect(stepMocks.fail).not.toHaveBeenCalled();
  });
});
