import { beforeEach, describe, expect, it, vi } from "vitest";

const restMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/rest", () => ({
  requestSupabaseRest: restMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("tiered deep scan work repository", () => {
  it("maps sync, claim, preview, heartbeat, completion, failure, and metrics RPCs", async () => {
    const repository = await import("./repository");
    restMock
      .mockResolvedValueOnce({ eligible_units: 2 })
      .mockResolvedValueOnce([
        {
          attempt_count: 1,
          coverage_tier: "priority",
          lease_acquired_at: "2026-07-27T14:00:00.000Z",
          lease_expires_at: "2026-07-27T15:00:00.000Z",
          lease_owner_id: "owner-1",
          lease_token: "token-1",
          next_due_at: "2026-07-27T14:00:00.000Z",
          option_type: "put",
          symbol: "AAPL",
          tier_priority: 1,
          tier_rank: 1,
        },
      ])
      .mockResolvedValueOnce([
        {
          coverage_tier: "daily",
          next_due_at: "2026-07-27T14:00:00.000Z",
          option_type: "call",
          symbol: "MSFT",
          tier_priority: 2,
          tier_rank: 300,
        },
      ])
      .mockResolvedValueOnce({ renewed_count: 1 })
      .mockResolvedValueOnce({ completed_count: 1, status: "complete" })
      .mockResolvedValueOnce({ failed_count: 1, status: "failed" })
      .mockResolvedValueOnce({ total_count: 2 });

    await repository.syncDeepScanWorkQueue();
    const claims = await repository.claimDeepScanWork({
      force: false,
      leaseSeconds: 3600,
      limit: 625,
      ownerId: "owner-1",
    });
    await repository.peekDeepScanWork({
      force: true,
      limit: 10,
    });
    await repository.heartbeatDeepScanWork({
      claims,
      leaseSeconds: 3600,
      ownerId: "owner-1",
    });
    await repository.completeDeepScanWorkBatch({
      batchId: "batch-1",
      ownerId: "owner-1",
      results: [{
        error: null,
        leaseToken: "token-1",
        optionContractCount: 3,
        optionType: "put",
        outcome: "complete",
        symbol: "AAPL",
      }],
    });
    await repository.failDeepScanWorkBatch({
      batchId: "batch-1",
      claims,
      error: "provider failed",
      ownerId: "owner-1",
    });
    await repository.getDeepScanWorkMetrics();

    expect(claims[0]).toMatchObject({
      coverageTier: "priority",
      leaseToken: "token-1",
      optionType: "put",
    });
    expect(restMock.mock.calls.map((call) => call[0])).toEqual([
      "rpc/sync_wheel_deep_scan_work_queue",
      "rpc/claim_wheel_deep_scan_work",
      "rpc/peek_wheel_deep_scan_work",
      "rpc/heartbeat_wheel_deep_scan_work",
      "rpc/complete_wheel_deep_scan_work_batch",
      "rpc/fail_wheel_deep_scan_work_batch",
      "rpc/get_wheel_deep_scan_work_metrics",
    ]);
    expect(restMock.mock.calls[4][1].body.p_results[0]).toEqual({
      error: null,
      lease_token: "token-1",
      option_contract_count: 3,
      option_type: "put",
      outcome: "complete",
      symbol: "AAPL",
    });
  });

  it("normalizes nullable claim and preview results", async () => {
    const repository = await import("./repository");
    restMock.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(repository.claimDeepScanWork({
      force: false,
      leaseSeconds: 60,
      limit: 1,
      ownerId: "owner",
    })).resolves.toEqual([]);
    await expect(repository.peekDeepScanWork({
      force: false,
      limit: 1,
    })).resolves.toEqual([]);
  });
});
