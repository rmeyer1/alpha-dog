import { beforeEach, describe, expect, it, vi } from "vitest";

const restMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/rest", () => ({
  requestSupabaseRest: restMock,
}));
vi.mock("../scanner-concurrency", () => ({
  upsertScannerRows: upsertMock,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shared market batch repository", () => {
  it("persists bounded parity metrics without provider or user payloads", async () => {
    const repository = await import("./repository");

    await repository.recordMarketBatchParityObservation({
      batchId: "batch-1",
      filterKey: "filters",
      marketDay: true,
      persona: "balanced_wheel",
      result: {
        candidateCount: { legacy: 1, replacement: 1 },
        exactMatch: false,
        formatVersion: 1,
        mismatchCount: 1,
        mismatches: {
          eligibility: 0,
          financial: 1,
          ordering: 0,
          score: 0,
          warning: 0,
        },
        samples: [{
          fields: ["bestCandidate.premiumReceived"],
          identity: "AAPL:short_put:2026-08-21:190:",
          kind: "financial",
        }],
      },
      strategy: "short_put",
    });

    expect(upsertMock).toHaveBeenCalledWith(
      "wheel_scanner_parity_observations",
      [expect.objectContaining({
        financial_mismatch_count: 1,
        market_day: true,
        mismatch_count: 1,
      })],
      "batch_id,persona,strategy,filter_key,format_version",
    );
    expect(JSON.stringify(upsertMock.mock.calls[0])).not.toMatch(
      /api[_-]?key|secret|prompt|account|portfolio/i,
    );
  });

  it("maps batch and snapshot RPC identities and rejects empty results", async () => {
    const repository = await import("./repository");
    restMock
      .mockResolvedValueOnce({
        batch_id: "batch-1",
        batch_key: "key",
        created: true,
        status: "running",
      })
      .mockResolvedValueOnce({
        snapshot_id: "snapshot-1",
        status: "building",
      });

    await expect(repository.createMarketBatch({
      batchKey: "key",
      feed: "opra",
      intervalStartedAt: "2026-07-27T14:00:00.000Z",
    })).resolves.toEqual({
      batchId: "batch-1",
      batchKey: "key",
      created: true,
      status: "running",
    });
    await expect(repository.createMarketBatchSnapshot({
      batchId: "batch-1",
      feed: "opra",
      filterKey: "filters",
      filters: {} as never,
      request: {
        persona: "balanced_wheel",
        strategy: "short_put",
      },
      response: {
        dataFreshness: {
          asOf: "2026-07-27T14:00:00.000Z",
          nextSuggestedRefreshAt: "2026-07-27T14:15:00.000Z",
        },
      } as never,
    })).resolves.toEqual({
      snapshot_id: "snapshot-1",
      status: "building",
    });

    restMock.mockResolvedValueOnce(null);
    await expect(repository.createMarketBatch({
      batchKey: "key",
      feed: "opra",
      intervalStartedAt: "2026-07-27T14:00:00.000Z",
    })).rejects.toThrow("did not return a wheel market batch identity");

    restMock.mockResolvedValueOnce(null);
    await expect(repository.createMarketBatchSnapshot({
      batchId: "batch-1",
      feed: "opra",
      filterKey: "filters",
      filters: {} as never,
      request: {
        persona: "balanced_wheel",
        strategy: "short_put",
      },
      response: {
        dataFreshness: {
          asOf: "2026-07-27T14:00:00.000Z",
          nextSuggestedRefreshAt: "2026-07-27T14:15:00.000Z",
        },
      } as never,
    })).rejects.toThrow("did not return a market batch snapshot");
  });

  it("reads nullable records and paginates fact tables", async () => {
    const repository = await import("./repository");
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({
      symbol: `SYM${index}`,
    }));
    restMock
      .mockResolvedValueOnce([{ id: "batch-1" }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ symbol: "AAPL" }])
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(fullPage)
      .mockResolvedValueOnce([{ symbol: "LAST" }])
      .mockResolvedValueOnce([]);

    await expect(repository.getMarketBatch("batch-1")).resolves.toEqual({
      id: "batch-1",
    });
    await expect(repository.getMarketBatch("missing")).resolves.toBeNull();
    await expect(
      repository.getMarketBatchOptionIngestion("batch-1", "AAPL", "put"),
    ).resolves.toEqual({ symbol: "AAPL" });
    await expect(
      repository.readMarketBatchUnderlying("batch-1", "MSFT"),
    ).resolves.toBeNull();
    await expect(
      repository.readMarketBatchUnderlyings("batch-1"),
    ).resolves.toHaveLength(1001);
    await expect(
      repository.readMarketBatchOptions("batch-1"),
    ).resolves.toEqual([]);

    expect(restMock.mock.calls.at(-2)?.[1]?.query.offset).toBe(1000);
  });

  it("reads only requested universe symbols in bounded chunks", async () => {
    const repository = await import("./repository");
    restMock
      .mockResolvedValueOnce([{
        company_name: "Apple Inc.",
        exchange: "NASDAQ",
        symbol: "AAPL",
      }])
      .mockResolvedValueOnce([]);

    const result = await repository.readScannerAssetsBySymbols([
      "aapl",
      ...Array.from({ length: 100 }, (_, index) => `S${index}`),
      "AAPL",
    ]);

    expect(result).toEqual([{
      exchange: "NASDAQ",
      name: "Apple Inc.",
      symbol: "AAPL",
    }]);
    expect(restMock).toHaveBeenCalledTimes(2);
    expect(restMock.mock.calls[0][1].query.symbol).toContain("\"AAPL\"");
    expect(restMock.mock.calls[0][1].query.active).toBe("eq.true");
  });

  it("persists facts, checkpoints, metrics, and completion summaries", async () => {
    const repository = await import("./repository");
    vi.setSystemTime(new Date("2026-07-27T14:00:00.000Z"));

    await repository.persistMarketBatchUnderlyings([{ symbol: "AAPL" }] as never);
    await repository.persistMarketBatchOptions([{
      contract_symbol: "AAPL-P",
    }] as never);
    await repository.checkpointMarketBatchUnderlyings("batch-1", {
      assetCount: 2,
      metrics: [],
      missingSymbols: [],
      rankedCount: 2,
      selectedCount: 1,
      selectedSymbols: ["AAPL"],
    });
    await repository.checkpointMarketBatchOptionIngestion("batch-1", {
      contractCount: 0,
      durationMs: -1.23456,
      error: "timeout",
      optionType: "put",
      symbol: "AAPL",
    });
    await repository.checkpointMarketBatchOptionIngestion("batch-1", {
      contractCount: 2,
      durationMs: 1.23456,
      error: null,
      optionType: "call",
      symbol: "AAPL",
    });
    await repository.upsertMarketBatchMetrics("batch-1", [{
      databaseRowsWritten: 2,
      durationMs: -2.34567,
      operation: "option_put",
      phase: "ingestion",
      providerRequests: 1,
    }]);
    await repository.completeMarketBatchFacts("batch-1", {
      assetCount: 2,
      errorCount: 1,
      errors: ["timeout"],
      metrics: [],
      optionContractCount: 2,
      rankedCount: 2,
      selectedCount: 1,
    });

    expect(upsertMock).toHaveBeenCalledTimes(5);
    expect(upsertMock.mock.calls[2][1][0]).toMatchObject({
      duration_ms: 0,
      status: "failed",
    });
    expect(upsertMock.mock.calls[3][1][0]).toMatchObject({
      duration_ms: 1.235,
      status: "complete",
    });
    expect(upsertMock.mock.calls[4][1][0].duration_ms).toBe(0);
    expect(restMock).toHaveBeenCalledTimes(2);
  });

  it("replaces candidates, stages snapshots, completes, fails, and prunes", async () => {
    const repository = await import("./repository");
    const company = {
      bestCandidate: {
        annualizedReturnOnRisk: null,
        annualizedYield: 0.4,
        delta: -0.2,
        dte: 20,
        expirationDate: "2026-08-21",
        impliedVolatility: 0.3,
        liquidityQuality: "excellent",
        longStrike: null,
        premiumReceived: 250,
        premiumYield: 0.025,
        returnOnRisk: null,
        score: 95,
        shortStrike: 95,
        strategy: "short_put",
        warningCount: 0,
      },
      errors: [],
      exchange: "NASDAQ",
      name: "Apple",
      rank: 1,
      score: 95,
      ticker: "AAPL",
      underlying: {
        asOf: "2026-07-27T14:00:00.000Z",
        movingAverages: { ma20: 195, ma50: 190, ma200: 180 },
        price: 200,
        rsi14: 55,
        symbol: "AAPL",
        trend: "bullish",
      },
      warnings: [],
    };
    restMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        batch_id: "batch-1",
        snapshot_id: "snapshot-1",
        staged: true,
        status: "complete",
      })
      .mockResolvedValueOnce({
        batch_id: "batch-1",
        pointer_count: 1,
        snapshot_count: 1,
        status: "complete",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(3);

    await repository.replaceMarketBatchSnapshotCandidates("snapshot-1", []);
    await repository.replaceMarketBatchSnapshotCandidates(
      "snapshot-1",
      [company] as never,
    );
    await expect(repository.publishMarketBatchSnapshot({
      candidateCount: 1,
      durationMs: 1,
      errors: [],
      screenedCount: 1,
      skippedCount: 0,
      snapshotId: "snapshot-1",
      warnings: [],
    })).resolves.toMatchObject({ staged: true });
    await expect(
      repository.completeMarketBatch("batch-1", 1),
    ).resolves.toMatchObject({ pointer_count: 1 });
    await repository.failMarketBatch("batch-1", new Error("provider failed"));
    await repository.failMarketBatch("batch-2", "unknown");
    await expect(
      repository.pruneMarketBatchHistory("2026-07-01T00:00:00.000Z"),
    ).resolves.toBe(3);

    expect(upsertMock).toHaveBeenCalledOnce();
    expect(restMock.mock.calls[4][1].body.p_error).toBe("provider failed");
    expect(restMock.mock.calls[5][1].body.p_error).toBe(
      "Market batch failed.",
    );

    restMock.mockResolvedValueOnce(null);
    await expect(repository.publishMarketBatchSnapshot({
      candidateCount: 0,
      durationMs: 0,
      errors: [],
      screenedCount: 0,
      skippedCount: 0,
      snapshotId: "snapshot-2",
      warnings: [],
    })).rejects.toThrow("did not return a publication result");
  });
});
