import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeepScanWorkClaim } from "./model";

const marketMocks = vi.hoisted(() => ({
  score: vi.fn(),
}));
const repositoryMocks = vi.hoisted(() => ({
  candidateRow: vi.fn(),
}));
const workRepositoryMocks = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("../market-batch/service", () => ({
  scoreSharedMarketBatchConsumer: marketMocks.score,
}));
vi.mock("../universe-scanner/repository", () => ({
  deepScanCandidateRow: repositoryMocks.candidateRow,
}));
vi.mock("./repository", () => ({
  heartbeatDeepScanWork: workRepositoryMocks.heartbeat,
  publishDeepScanCompatibility: workRepositoryMocks.publish,
}));

function claim(symbol: string): DeepScanWorkClaim {
  return {
    attemptCount: 1,
    coverageTier: "priority",
    leaseAcquiredAt: "2026-07-27T14:00:00.000Z",
    leaseExpiresAt: "2026-07-27T15:00:00.000Z",
    leaseOwnerId: "owner",
    leaseToken: `token-${symbol}`,
    nextDueAt: "2026-07-27T14:00:00.000Z",
    optionType: "put",
    symbol,
    tierPriority: 1,
    tierRank: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  marketMocks.score.mockResolvedValue({
    companies: [{ ticker: "AAPL", score: 95 }],
  });
  repositoryMocks.candidateRow.mockReturnValue({
    filter_key: "filter",
    option_type: "put",
    persona: "balanced_wheel",
    strategy: "short_put",
    symbol: "AAPL",
  });
});

describe("tiered deep scan compatibility publication", () => {
  it("updates legacy candidate and coverage readers without publishing a market pointer", async () => {
    const { publishTieredDeepScanCompatibility } = await import("./service");
    const result = await publishTieredDeepScanCompatibility({
      batchId: "batch-1",
      claims: [claim("AAPL"), claim("MSFT"), claim("MISSING")],
      leaseSeconds: 3600,
      optionStages: [
        {
          contractCount: 4,
          durationMs: 1,
          error: null,
          optionType: "put",
          providerRequests: 1,
          symbol: "AAPL",
        },
        {
          contractCount: 0,
          durationMs: 1,
          error: null,
          optionType: "put",
          providerRequests: 1,
          symbol: "MSFT",
        },
      ],
      ownerId: "owner",
      requests: [{
        persona: "balanced_wheel",
        strategy: "short_put",
      }],
    });

    expect(result).toEqual({
      candidateCount: 1,
      consumerCount: 1,
      coverageRowCount: 3,
    });
    expect(workRepositoryMocks.heartbeat).toHaveBeenCalledWith({
      claims: expect.any(Array),
      leaseSeconds: 3600,
      ownerId: "owner",
    });
    expect(workRepositoryMocks.publish).toHaveBeenCalledWith({
      candidates: [expect.objectContaining({ symbol: "AAPL" })],
      claims: expect.any(Array),
      coverage: [
        expect.objectContaining({ status: "complete", symbol: "AAPL" }),
        expect.objectContaining({ status: "no_candidate", symbol: "MSFT" }),
        expect.objectContaining({
          error: "Claimed underlying facts were unavailable.",
          status: "failed",
          symbol: "MISSING",
        }),
      ],
      leaseSeconds: 3600,
      ownerId: "owner",
    });
  });

  it("rejects stale work before touching legacy reader tables", async () => {
    const { publishTieredDeepScanCompatibility } = await import("./service");
    workRepositoryMocks.heartbeat.mockRejectedValueOnce(
      new Error("Wheel deep-scan claim ownership is stale."),
    );

    await expect(
      publishTieredDeepScanCompatibility({
        batchId: "batch-1",
        claims: [claim("AAPL")],
        leaseSeconds: 3600,
        optionStages: [],
        ownerId: "stale-owner",
        requests: [{
          persona: "balanced_wheel",
          strategy: "short_put",
        }],
      }),
    ).rejects.toThrow("ownership is stale");
    expect(marketMocks.score).not.toHaveBeenCalled();
    expect(workRepositoryMocks.publish).not.toHaveBeenCalled();
  });

  it("rejects a reclaimed lease at the atomic mutation boundary", async () => {
    const { publishTieredDeepScanCompatibility } = await import("./service");
    workRepositoryMocks.publish.mockRejectedValueOnce(
      new Error("Wheel deep-scan compatibility ownership is stale."),
    );

    await expect(
      publishTieredDeepScanCompatibility({
        batchId: "batch-1",
        claims: [claim("AAPL")],
        leaseSeconds: 3600,
        optionStages: [],
        ownerId: "reclaimed-owner",
        requests: [{
          persona: "balanced_wheel",
          strategy: "short_put",
        }],
      }),
    ).rejects.toThrow("compatibility ownership is stale");
    expect(marketMocks.score).toHaveBeenCalledOnce();
    expect(workRepositoryMocks.publish).toHaveBeenCalledOnce();
  });
});
