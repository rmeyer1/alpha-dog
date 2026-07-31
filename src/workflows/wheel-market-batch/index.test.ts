import { beforeEach, describe, expect, it, vi } from "vitest";

const stepMocks = vi.hoisted(() => ({
  completeLegacy: vi.fn(),
  fail: vi.fn(),
  finalizeFacts: vi.fn(),
  finish: vi.fn(),
  prepare: vi.fn(),
  publish: vi.fn(),
  recordLifecycle: vi.fn(),
  recordParity: vi.fn(),
  score: vi.fn(),
  stageOption: vi.fn(),
  stageUnderlyings: vi.fn(),
}));

vi.mock("./steps", () => ({
  completeLegacyMarketBatchSnapshotStep: stepMocks.completeLegacy,
  failMarketBatchStep: stepMocks.fail,
  finalizeMarketBatchFactsStep: stepMocks.finalizeFacts,
  finishMarketBatchStep: stepMocks.finish,
  prepareMarketBatchStep: stepMocks.prepare,
  publishMarketBatchSnapshotStep: stepMocks.publish,
  recordMarketBatchParityObservationStep: stepMocks.recordParity,
  recordMarketBatchWorkflowLifecycle: stepMocks.recordLifecycle,
  stageMarketBatchConsumerStep: stepMocks.score,
  stageMarketBatchOptionStep: stepMocks.stageOption,
  stageMarketBatchUnderlyingsStep: stepMocks.stageUnderlyings,
}));

const requests = [
  { persona: "balanced_wheel" as const, strategy: "short_put" as const },
  { persona: "balanced_wheel" as const, strategy: "covered_call" as const },
];
const telemetryContext = {
  correlationId: "correlation-1",
  logicalOperationId: "logical-1",
  startedAtEpochMs: 1,
};

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
  missingSymbols: [],
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
      legacy: {
        error: null,
        processedCount: 1,
        skippedCount: 0,
        snapshotId: "legacy-put",
        totalCount: 1,
      },
      parity: {
        candidateCount: { legacy: 1, replacement: 1 },
        exactMatch: true,
        formatVersion: 1,
        mismatchCount: 0,
        mismatches: {
          eligibility: 0,
          financial: 0,
          ordering: 0,
          score: 0,
          warning: 0,
        },
        samples: [],
      },
      replacement: {
        candidateCount: 1,
        durationMs: 4,
        errors: [],
        screenedCount: 1,
        skippedCount: 0,
        snapshotId: "snapshot-put",
        warnings: [],
      },
    })
    .mockResolvedValueOnce({
      legacy: {
        error: null,
        processedCount: 1,
        skippedCount: 0,
        snapshotId: "legacy-call",
        totalCount: 1,
      },
      parity: {
        candidateCount: { legacy: 1, replacement: 1 },
        exactMatch: true,
        formatVersion: 1,
        mismatchCount: 0,
        mismatches: {
          eligibility: 0,
          financial: 0,
          ordering: 0,
          score: 0,
          warning: 0,
        },
        samples: [],
      },
      replacement: {
        candidateCount: 1,
        durationMs: 6,
        errors: [],
        screenedCount: 1,
        skippedCount: 0,
        snapshotId: "snapshot-call",
        warnings: [],
      },
    });
  stepMocks.publish
    .mockResolvedValueOnce({ durationMs: 2, staged: true })
    .mockResolvedValueOnce({ durationMs: 3, staged: true });
});

describe("wheel market batch workflow", () => {
  it("fans shared facts into consumers while passing only identifiers", async () => {
    const { wheelMarketBatchWorkflow } = await import("./index");
    const result = await wheelMarketBatchWorkflow(
      {
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      },
      telemetryContext,
    );

    expect(stepMocks.stageUnderlyings).toHaveBeenCalledWith("batch-1");
    expect(stepMocks.stageOption.mock.calls).toEqual([
      ["batch-1", "AAPL", "put", { dteMin: 7, dteMax: 45 }],
      ["batch-1", "AAPL", "call", { dteMin: 7, dteMax: 45 }],
    ]);
    expect(stepMocks.score.mock.calls).toEqual([
      ["batch-1", requests[0]],
      ["batch-1", requests[1]],
    ]);
    expect(stepMocks.completeLegacy.mock.calls).toEqual([
      [{
        error: null,
        processedCount: 1,
        skippedCount: 0,
        snapshotId: "legacy-put",
        totalCount: 1,
      }],
      [{
        error: null,
        processedCount: 1,
        skippedCount: 0,
        snapshotId: "legacy-call",
        totalCount: 1,
      }],
    ]);
    expect(stepMocks.finish).toHaveBeenCalledWith("batch-1", 2, 2, 10, 5);
    expect(stepMocks.recordLifecycle.mock.calls).toEqual([
      [telemetryContext, "resumed"],
      [telemetryContext, "completed"],
    ]);
    expect(stepMocks.recordParity).toHaveBeenCalledTimes(2);
    expect(stepMocks.recordParity.mock.calls[0]).toEqual([
      "batch-1",
      expect.objectContaining({ exactMatch: true }),
      requests[0],
      "2026-07-27T14:00:00.000Z",
    ]);
    expect(stepMocks.recordParity.mock.calls[1]).toEqual([
      "batch-1",
      expect.objectContaining({ exactMatch: true }),
      requests[1],
      "2026-07-27T14:00:00.000Z",
    ]);
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
      wheelMarketBatchWorkflow(
        {
          intervalStartedAt: "2026-07-27T14:00:00.000Z",
          requests,
        },
        telemetryContext,
      ),
    ).rejects.toThrow("all option providers failed");
    expect(stepMocks.score).not.toHaveBeenCalled();
    expect(stepMocks.publish).not.toHaveBeenCalled();
    expect(stepMocks.fail).toHaveBeenCalledWith(
      "batch-1",
      "all option providers failed",
    );
    expect(stepMocks.recordLifecycle).toHaveBeenLastCalledWith(
      telemetryContext,
      "failed",
    );
  });

  it("does not activate staged legacy snapshots when atomic batch completion fails", async () => {
    stepMocks.finish.mockRejectedValueOnce(new Error("pointer transaction failed"));
    const { wheelMarketBatchWorkflow } = await import("./index");

    await expect(
      wheelMarketBatchWorkflow({
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      }),
    ).rejects.toThrow("pointer transaction failed");
    expect(stepMocks.score).toHaveBeenCalledTimes(2);
    expect(stepMocks.completeLegacy).toHaveBeenCalled();
    expect(stepMocks.recordParity).toHaveBeenCalledTimes(2);
    expect(stepMocks.fail).toHaveBeenCalledWith(
      "batch-1",
      "pointer transaction failed",
    );
  });

  it("does not record parity observations when legacy completion fails after replacement publication", async () => {
    stepMocks.completeLegacy.mockRejectedValueOnce(
      new Error("legacy snapshot summary update failed"),
    );
    const { wheelMarketBatchWorkflow } = await import("./index");

    await expect(
      wheelMarketBatchWorkflow({
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      }),
    ).rejects.toThrow("legacy snapshot summary update failed");
    expect(stepMocks.score).toHaveBeenCalledTimes(2);
    expect(stepMocks.publish).toHaveBeenCalledTimes(2);
    expect(stepMocks.finish).not.toHaveBeenCalled();
    expect(stepMocks.completeLegacy).toHaveBeenCalled();
    expect(stepMocks.fail).toHaveBeenCalledWith(
      "batch-1",
      "legacy snapshot summary update failed",
    );
    expect(stepMocks.recordParity).not.toHaveBeenCalled();
  });

  it("does not mark the batch complete when batch finish fails after parity recording", async () => {
    stepMocks.finish.mockRejectedValueOnce(
      new Error("pointer transaction failed"),
    );
    const { wheelMarketBatchWorkflow } = await import("./index");

    await expect(
      wheelMarketBatchWorkflow({
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      }),
    ).rejects.toThrow("pointer transaction failed");
    expect(stepMocks.recordParity).toHaveBeenCalledTimes(2);
    expect(stepMocks.fail).toHaveBeenCalledWith(
      "batch-1",
      "pointer transaction failed",
    );
  });

  it("does not mark the batch complete when one parity observation fails", async () => {
    stepMocks.recordParity
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("parity upsert failed"));
    const { wheelMarketBatchWorkflow } = await import("./index");

    await expect(
      wheelMarketBatchWorkflow({
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      }),
    ).rejects.toThrow("parity upsert failed");
    expect(stepMocks.recordParity).toHaveBeenCalledTimes(2);
    expect(stepMocks.finish).not.toHaveBeenCalled();
    expect(stepMocks.fail).toHaveBeenCalledWith(
      "batch-1",
      "parity upsert failed",
    );
  });

  it("records a stable message for non-Error failures", async () => {
    stepMocks.finalizeFacts.mockRejectedValueOnce("unknown");
    const { wheelMarketBatchWorkflow } = await import("./index");

    await expect(
      wheelMarketBatchWorkflow({
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
        requests,
      }),
    ).rejects.toBe("unknown");
    expect(stepMocks.fail).toHaveBeenCalledWith(
      "batch-1",
      "Market batch workflow failed.",
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
