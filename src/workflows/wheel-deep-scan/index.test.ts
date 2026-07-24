import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UniverseDeepScanCoverageResult } from "@/lib/wheel/universe-scanner";

const completeDeepScanCoverageBatchMock = vi.hoisted(() => vi.fn());
const failDeepScanCoverageBatchMock = vi.hoisted(() => vi.fn());
const recordDeepScanWorkflowLifecycleMock = vi.hoisted(() => vi.fn());
const stageDeepScanCoverageBatchMock = vi.hoisted(() => vi.fn());

vi.mock("./steps", () => ({
  completeDeepScanCoverageBatch: completeDeepScanCoverageBatchMock,
  failDeepScanCoverageBatch: failDeepScanCoverageBatchMock,
  recordDeepScanWorkflowLifecycle: recordDeepScanWorkflowLifecycleMock,
  stageDeepScanCoverageBatch: stageDeepScanCoverageBatchMock,
}));

const result: UniverseDeepScanCoverageResult = {
  batchSize: 1,
  candidateCount: 1,
  errorCount: 0,
  errors: [],
  filterKey: "{}",
  persona: "balanced_wheel",
  runId: "11111111-1111-1111-1111-111111111111",
  scannedCount: 1,
  scannedSymbols: ["AAPL"],
  selectedCount: 1,
  skippedReason: null,
  staleBefore: "2026-07-22T14:00:00.000Z",
  strategy: "short_put",
  totalEligibleCount: 1,
};
const telemetryContext = {
  correlationId: "workflow-correlation-1",
  logicalOperationId: "workflow-operation-1",
};

beforeEach(() => {
  completeDeepScanCoverageBatchMock.mockReset();
  failDeepScanCoverageBatchMock.mockReset();
  recordDeepScanWorkflowLifecycleMock.mockReset();
  stageDeepScanCoverageBatchMock.mockReset();
});

describe("wheel deep scan workflow", () => {
  it("passes only the run identifier across the publication boundary", async () => {
    stageDeepScanCoverageBatchMock.mockResolvedValue({
      result: null,
      runId: result.runId,
    });
    completeDeepScanCoverageBatchMock.mockResolvedValue(result);
    const { wheelDeepScanWorkflow } = await import("./index");

    await expect(
      wheelDeepScanWorkflow({
        persona: "balanced_wheel",
        strategy: "short_put",
        workflowIdempotencyKey: "wrun_ad017_test",
      }, telemetryContext),
    ).resolves.toEqual(result);

    expect(stageDeepScanCoverageBatchMock).toHaveBeenCalledOnce();
    expect(stageDeepScanCoverageBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        persona: "balanced_wheel",
        strategy: "short_put",
      }),
      expect.any(String),
      expect.objectContaining({
        correlationId: expect.any(String),
        logicalOperationId: expect.any(String),
      }),
    );
    expect(completeDeepScanCoverageBatchMock).toHaveBeenCalledWith(
      result.runId,
      expect.objectContaining({
        correlationId: expect.any(String),
        logicalOperationId: expect.any(String),
      }),
    );
    expect(failDeepScanCoverageBatchMock).not.toHaveBeenCalled();
  });

  it("does not replay provider staging after a late publication failure", async () => {
    stageDeepScanCoverageBatchMock.mockResolvedValue({
      result: null,
      runId: result.runId,
    });
    completeDeepScanCoverageBatchMock.mockRejectedValue(
      new Error("publication failed"),
    );
    failDeepScanCoverageBatchMock.mockResolvedValue(undefined);
    const { wheelDeepScanWorkflow } = await import("./index");

    await expect(
      wheelDeepScanWorkflow({
        persona: "balanced_wheel",
        strategy: "short_put",
        workflowIdempotencyKey: "wrun_ad017_test",
      }, telemetryContext),
    ).rejects.toThrow("publication failed");

    expect(stageDeepScanCoverageBatchMock).toHaveBeenCalledOnce();
    expect(completeDeepScanCoverageBatchMock).toHaveBeenCalledOnce();
    expect(failDeepScanCoverageBatchMock).toHaveBeenCalledWith(
      result.runId,
      "publication failed",
      expect.objectContaining({
        correlationId: expect.any(String),
        logicalOperationId: expect.any(String),
      }),
    );
  });

  it("returns a lease-conflict skip without publishing", async () => {
    const skipped = {
      ...result,
      candidateCount: 0,
      runId: null,
      scannedCount: 0,
      scannedSymbols: [],
      selectedCount: 0,
      skippedReason: "A matching deep scan is already active.",
    };
    stageDeepScanCoverageBatchMock.mockResolvedValue({
      result: skipped,
      runId: null,
    });
    const { wheelDeepScanWorkflow } = await import("./index");

    await expect(
      wheelDeepScanWorkflow({
        persona: "balanced_wheel",
        strategy: "short_put",
        workflowIdempotencyKey: "wrun_ad017_test",
      }, telemetryContext),
    ).resolves.toEqual(skipped);
    expect(completeDeepScanCoverageBatchMock).not.toHaveBeenCalled();
  });
});
