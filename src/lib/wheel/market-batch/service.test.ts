import { beforeEach, describe, expect, it, vi } from "vitest";

const alpacaMocks = vi.hoisted(() => ({
  getStockSnapshotsBySymbols: vi.fn(),
  getWheelAssetUniverse: vi.fn(),
}));
const earningsMocks = vi.hoisted(() => ({
  emptyEarningsRiskContext: vi.fn((symbol: string) => ({
    asOf: null,
    coverageThrough: null,
    events: [],
    providerEnabled: false,
    symbol,
  })),
  getCachedEarningsRiskContexts: vi.fn(),
}));
const marketServiceMocks = vi.hoisted(() => ({
  buildDeepScanUniverse: vi.fn(),
  ensureTechnicals: vi.fn(),
  refreshCandidateContracts: vi.fn(),
}));
const domainMocks = vi.hoisted(() => ({
  rankUnderlyingUniverse: vi.fn(),
}));
const repositoryMocks = vi.hoisted(() => ({
  checkpointMarketBatchOptionIngestion: vi.fn(),
  checkpointMarketBatchUnderlyings: vi.fn(),
  completeMarketBatch: vi.fn(),
  completeMarketBatchFacts: vi.fn(),
  createMarketBatch: vi.fn(),
  createMarketBatchSnapshot: vi.fn(),
  failMarketBatch: vi.fn(),
  getMarketBatch: vi.fn(),
  getMarketBatchOptionIngestion: vi.fn(),
  persistMarketBatchOptions: vi.fn(),
  persistMarketBatchUnderlyings: vi.fn(),
  publishMarketBatchSnapshot: vi.fn(),
  readMarketBatchOptions: vi.fn(),
  readMarketBatchUnderlying: vi.fn(),
  readMarketBatchUnderlyings: vi.fn(),
  readScannerAssetsBySymbols: vi.fn(),
  recordMarketBatchParityObservation: vi.fn(),
  replaceMarketBatchSnapshotCandidates: vi.fn(),
  upsertMarketBatchMetrics: vi.fn(),
}));

vi.mock("@/lib/alpaca/client", () => alpacaMocks);
vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    ALPACA_OPTIONS_FEED: "opra",
    ALPACA_STOCK_FEED: "sip",
    WHEEL_UNIVERSE_DEEP_SCAN_SIZE: 1,
    WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE: 1000,
  }),
}));
vi.mock("../earnings", () => earningsMocks);
vi.mock("../universe-scanner/market-service", () => marketServiceMocks);
vi.mock("../universe-scanner/domain", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../universe-scanner/domain")
  >();

  return {
    ...original,
    rankUnderlyingUniverse: domainMocks.rankUnderlyingUniverse,
  };
});
vi.mock("./repository", () => repositoryMocks);

const batch = {
  asset_count: 0,
  batch_key: "batch-key",
  error_count: 0,
  feed: "opra" as const,
  id: "batch-1",
  interval_started_at: "2026-07-27T14:00:00.000Z",
  option_contract_count: 0,
  ranked_count: 0,
  selected_count: 0,
  snapshot_count: 0,
  status: "running" as const,
  summary: {},
  underlyings_completed_at: null,
};
const asset = {
  symbol: "AAPL",
  name: "Apple Inc.",
  exchange: "NASDAQ" as const,
};
const stockSnapshot = {
  dailyBar: { c: 200, v: 1_000_000 },
  latestTrade: { p: 200, t: "2026-07-27T14:00:00.000Z" },
  prevDailyBar: { c: 198 },
};
const ranked = {
  asset,
  dollarVolume: 200_000_000,
  pctChange: 0.01,
  price: 200,
  snapshot: stockSnapshot,
  stockScore: 100,
};
const persistedUnderlying = {
  batch_id: "batch-1",
  captured_at: "2026-07-27T14:00:00.000Z",
  company_name: "Apple Inc.",
  daily_volume: 1_000_000,
  dollar_volume: 200_000_000,
  earnings_as_of: null,
  earnings_context: earningsMocks.emptyEarningsRiskContext("AAPL"),
  exchange: "NASDAQ" as const,
  latest_trade_at: "2026-07-27T14:00:00.000Z",
  ma20: 195,
  ma50: 190,
  ma200: 180,
  pct_change: 0.01,
  previous_close: 198,
  price: 200,
  rsi14: 55,
  selected_for_scoring: true,
  stock_score: 100,
  stock_snapshot: stockSnapshot,
  symbol: "AAPL",
  technical_as_of: "2026-07-27T14:00:00.000Z",
  trend: "bullish" as const,
  universe_rank: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  repositoryMocks.getMarketBatch.mockResolvedValue({ ...batch });
  alpacaMocks.getWheelAssetUniverse.mockResolvedValue([asset]);
  alpacaMocks.getStockSnapshotsBySymbols.mockResolvedValue({
    AAPL: stockSnapshot,
  });
  domainMocks.rankUnderlyingUniverse.mockReturnValue([ranked]);
  marketServiceMocks.buildDeepScanUniverse.mockResolvedValue([ranked]);
  marketServiceMocks.ensureTechnicals.mockResolvedValue({
    cached: new Map([
      [
        "AAPL",
        {
          calculated_at: "2026-07-27T14:00:00.000Z",
          ma20: 195,
          ma50: 190,
          ma200: 180,
          rsi14: 55,
          symbol: "AAPL",
          trend: "bullish",
        },
      ],
    ]),
    summary: {
      cachedFreshCount: 0,
      refreshedCount: 1,
      requestedCount: 1,
    },
  });
  earningsMocks.getCachedEarningsRiskContexts.mockResolvedValue(
    new Map([["AAPL", earningsMocks.emptyEarningsRiskContext("AAPL")]]),
  );
  repositoryMocks.readMarketBatchUnderlying.mockResolvedValue(
    persistedUnderlying,
  );
  repositoryMocks.readScannerAssetsBySymbols.mockResolvedValue([asset]);
  repositoryMocks.getMarketBatchOptionIngestion.mockResolvedValue(null);
  marketServiceMocks.refreshCandidateContracts.mockResolvedValue({
    contracts: [{
      ask: 2.6,
      bid: 2.5,
      contractSymbol: "AAPL260821P00190000",
      delta: -0.24,
      expirationDate: "2026-08-21",
      impliedVolatility: 0.3,
      openInterest: 1_000,
      optionType: "put",
      strike: 190,
      theta: -0.05,
      volume: 500,
    }],
    summary: {},
  });
});

describe("shared market batch service", () => {
  it("creates canonical and caller-keyed batch identities", async () => {
    const { prepareSharedMarketBatch } = await import("./service");

    await prepareSharedMarketBatch({
      feed: "opra",
      intervalStartedAt: "2026-07-27T14:00:00.000Z",
    });
    await prepareSharedMarketBatch({
      batchKey: "caller-key",
      feed: "indicative",
      intervalStartedAt: "2026-07-27T14:15:00.000Z",
    });

    expect(repositoryMocks.createMarketBatch.mock.calls).toEqual([
      [{
        batchKey: "wheel-market-batch:opra:2026-07-27T14:00:00.000Z",
        feed: "opra",
        intervalStartedAt: "2026-07-27T14:00:00.000Z",
      }],
      [{
        batchKey: "caller-key",
        feed: "indicative",
        intervalStartedAt: "2026-07-27T14:15:00.000Z",
      }],
    ]);
  });

  it("refreshes and checkpoints shared underlyings once across replay", async () => {
    const { stageSharedMarketBatchUnderlyings } = await import("./service");
    const first = await stageSharedMarketBatchUnderlyings("batch-1");

    repositoryMocks.getMarketBatch.mockResolvedValueOnce({
      ...batch,
      asset_count: 1,
      ranked_count: 1,
      selected_count: 1,
      summary: { underlyings: { metrics: first.metrics } },
      underlyings_completed_at: "2026-07-27T14:00:05.000Z",
    });
    repositoryMocks.readMarketBatchUnderlyings.mockResolvedValueOnce([
      persistedUnderlying,
    ]);
    const replay = await stageSharedMarketBatchUnderlyings("batch-1");
    repositoryMocks.getMarketBatch.mockResolvedValueOnce({
      ...batch,
      asset_count: 1,
      ranked_count: 1,
      selected_count: 1,
      summary: { underlyings: {} },
      underlyings_completed_at: "2026-07-27T14:00:05.000Z",
    });
    repositoryMocks.readMarketBatchUnderlyings.mockResolvedValueOnce([
      persistedUnderlying,
    ]);
    const replayWithoutStoredMetrics = await stageSharedMarketBatchUnderlyings(
      "batch-1",
    );

    expect(alpacaMocks.getWheelAssetUniverse).toHaveBeenCalledOnce();
    expect(alpacaMocks.getStockSnapshotsBySymbols).toHaveBeenCalledOnce();
    expect(marketServiceMocks.ensureTechnicals).toHaveBeenCalledOnce();
    expect(earningsMocks.getCachedEarningsRiskContexts).toHaveBeenCalledOnce();
    expect(repositoryMocks.persistMarketBatchUnderlyings).toHaveBeenCalledOnce();
    expect(repositoryMocks.checkpointMarketBatchUnderlyings)
      .toHaveBeenCalledOnce();
    expect(replay.selectedSymbols).toEqual(["AAPL"]);
    expect(replayWithoutStoredMetrics.metrics).toEqual([]);
  });

  it("loads only claimed symbols and records unavailable queue members", async () => {
    const { stageSharedMarketBatchUnderlyings } = await import("./service");
    const result = await stageSharedMarketBatchUnderlyings(
      "batch-1",
      ["aapl", "MISSING", "AAPL"],
    );

    expect(repositoryMocks.readScannerAssetsBySymbols).toHaveBeenCalledWith([
      "AAPL",
      "MISSING",
    ]);
    expect(alpacaMocks.getWheelAssetUniverse).not.toHaveBeenCalled();
    expect(alpacaMocks.getStockSnapshotsBySymbols).toHaveBeenCalledWith(
      ["AAPL"],
      expect.any(Object),
    );
    expect(marketServiceMocks.buildDeepScanUniverse).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      missingSymbols: ["MISSING"],
      selectedSymbols: ["AAPL"],
    });
    expect(repositoryMocks.checkpointMarketBatchUnderlyings)
      .toHaveBeenCalledWith(
        "batch-1",
        expect.objectContaining({ missingSymbols: ["MISSING"] }),
      );
  });

  it("rejects missing and failed batches before provider work", async () => {
    const { stageSharedMarketBatchUnderlyings } = await import("./service");
    repositoryMocks.getMarketBatch.mockResolvedValueOnce(null);
    await expect(
      stageSharedMarketBatchUnderlyings("missing"),
    ).rejects.toThrow("was not found");

    repositoryMocks.getMarketBatch.mockResolvedValueOnce({
      ...batch,
      status: "failed",
    });
    await expect(
      stageSharedMarketBatchUnderlyings("batch-1"),
    ).rejects.toThrow("already failed");
    expect(alpacaMocks.getWheelAssetUniverse).not.toHaveBeenCalled();
  });

  it("performs at most one discovery per symbol and option type", async () => {
    const { stageSharedMarketBatchOptions } = await import("./service");
    const filters = {
      dteMin: 7,
      dteMax: 45,
      deltaMin: 0.15,
      deltaMax: 0.4,
      minPremiumYield: 0.0075,
      minVolume: 50,
      minOpenInterest: 100,
      maxSpreadPctOfMid: 0.25,
      minSpreadReturnOnRisk: 0.2,
      maxSpreadWidth: 10,
      spreadLongLegCount: 3,
      excludeEarnings: false,
      includeWeeklies: true,
    };
    const first = await stageSharedMarketBatchOptions({
      batchId: "batch-1",
      filters,
      optionType: "put",
      symbol: "AAPL",
    });

    repositoryMocks.getMarketBatchOptionIngestion.mockResolvedValueOnce({
      batch_id: "batch-1",
      completed_at: "2026-07-27T14:00:05.000Z",
      contract_count: 1,
      duration_ms: first.durationMs,
      error: null,
      option_type: "put",
      status: "complete",
      symbol: "AAPL",
    });
    await stageSharedMarketBatchOptions({
      batchId: "batch-1",
      filters,
      optionType: "put",
      symbol: "AAPL",
    });

    expect(marketServiceMocks.refreshCandidateContracts).toHaveBeenCalledOnce();
    expect(repositoryMocks.persistMarketBatchOptions).toHaveBeenCalledOnce();
    expect(repositoryMocks.checkpointMarketBatchOptionIngestion)
      .toHaveBeenCalledOnce();
  });

  it("retries persistence failures instead of checkpointing them as provider failures", async () => {
    const { stageSharedMarketBatchOptions } = await import("./service");
    repositoryMocks.persistMarketBatchOptions.mockRejectedValueOnce(
      new Error("database unavailable"),
    );

    await expect(
      stageSharedMarketBatchOptions({
        batchId: "batch-1",
        filters: {
          dteMin: 7,
          dteMax: 45,
          deltaMin: 0.15,
          deltaMax: 0.4,
          minPremiumYield: 0.0075,
          minVolume: 50,
          minOpenInterest: 100,
          maxSpreadPctOfMid: 0.25,
          minSpreadReturnOnRisk: 0.2,
          maxSpreadWidth: 10,
          spreadLongLegCount: 3,
          excludeEarnings: false,
          includeWeeklies: true,
        },
        optionType: "put",
        symbol: "AAPL",
      }),
    ).rejects.toThrow("database unavailable");
    expect(repositoryMocks.checkpointMarketBatchOptionIngestion)
      .not.toHaveBeenCalled();
  });

  it("rejects invalid option facts and checkpoints provider failures", async () => {
    const { stageSharedMarketBatchOptions } = await import("./service");
    const filters = {
      dteMin: 7,
      dteMax: 45,
      deltaMin: 0.15,
      deltaMax: 0.4,
      minPremiumYield: 0.0075,
      minVolume: 50,
      minOpenInterest: 100,
      maxSpreadPctOfMid: 0.25,
      minSpreadReturnOnRisk: 0.2,
      maxSpreadWidth: 10,
      spreadLongLegCount: 3,
      excludeEarnings: false,
      includeWeeklies: true,
    };

    repositoryMocks.readMarketBatchUnderlying.mockResolvedValueOnce(null);
    await expect(stageSharedMarketBatchOptions({
      batchId: "batch-1",
      filters,
      optionType: "put",
      symbol: "MSFT",
    })).rejects.toThrow("no selected underlying");

    repositoryMocks.readMarketBatchUnderlying.mockResolvedValueOnce({
      ...persistedUnderlying,
      price: 0,
    });
    await expect(stageSharedMarketBatchOptions({
      batchId: "batch-1",
      filters,
      optionType: "put",
      symbol: "AAPL",
    })).rejects.toThrow("invalid persisted facts");

    marketServiceMocks.refreshCandidateContracts
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce("unknown");
    await expect(stageSharedMarketBatchOptions({
      batchId: "batch-1",
      filters,
      optionType: "call",
      symbol: "AAPL",
    })).resolves.toMatchObject({
      contractCount: 0,
      error: "AAPL call: timeout",
    });
    await expect(stageSharedMarketBatchOptions({
      batchId: "batch-1",
      filters,
      optionType: "call",
      symbol: "AAPL",
    })).resolves.toMatchObject({
      contractCount: 0,
      error: "AAPL call: option discovery failed",
    });
    expect(repositoryMocks.checkpointMarketBatchOptionIngestion)
      .toHaveBeenCalledTimes(2);
  });

  it("allows partial symbols but rejects a required-type outage", async () => {
    const {
      finalizeSharedMarketBatchFacts,
      finalizeSharedMarketCoverageFacts,
    } = await import("./service");
    const underlyingStage = {
      assetCount: 1,
      metrics: [],
      missingSymbols: [],
      rankedCount: 1,
      selectedCount: 1,
      selectedSymbols: ["AAPL"],
    };
    const partial = await finalizeSharedMarketBatchFacts({
      batchId: "batch-1",
      underlyingStage,
      optionStages: [
        {
          contractCount: 1,
          durationMs: 10,
          error: null,
          optionType: "put",
          providerRequests: 1,
          symbol: "AAPL",
        },
        {
          contractCount: 0,
          durationMs: 12,
          error: "MSFT put: timeout",
          optionType: "put",
          providerRequests: 1,
          symbol: "MSFT",
        },
        {
          contractCount: 1,
          durationMs: 8,
          error: null,
          optionType: "call",
          providerRequests: 1,
          symbol: "AAPL",
        },
      ],
    });

    expect(partial.errorCount).toBe(1);
    expect(repositoryMocks.completeMarketBatchFacts).toHaveBeenCalledOnce();

    await expect(
      finalizeSharedMarketCoverageFacts({
        batchId: "batch-coverage",
        underlyingStage,
        optionStages: [{
          contractCount: 0,
          durationMs: 12,
          error: "AAPL call: timeout",
          optionType: "call",
          providerRequests: 1,
          symbol: "AAPL",
        }],
      }),
    ).resolves.toMatchObject({
      errorCount: 1,
      optionContractCount: 0,
    });
    expect(repositoryMocks.completeMarketBatchFacts).toHaveBeenCalledTimes(2);

    await expect(
      finalizeSharedMarketBatchFacts({
        batchId: "batch-2",
        underlyingStage,
        optionStages: [{
          contractCount: 1,
          durationMs: 10,
          error: null,
          optionType: "put",
          providerRequests: 1,
          symbol: "AAPL",
        }, {
          contractCount: 0,
          durationMs: 12,
          error: "AAPL call: timeout",
          optionType: "call",
          providerRequests: 1,
          symbol: "AAPL",
        }],
      }),
    ).rejects.toThrow(
      "Every shared call option-ingestion operation failed.",
    );
    expect(repositoryMocks.completeMarketBatchFacts).toHaveBeenCalledTimes(2);
  });

  it("scores, stages, publishes, completes, fails, and exposes discovery filters", async () => {
    const service = await import("./service");
    const request = {
      persona: "balanced_wheel" as const,
      strategy: "short_put" as const,
    };
    repositoryMocks.getMarketBatch.mockResolvedValue({
      ...batch,
      status: "facts_ready",
      summary: { errors: ["one", 2] },
    });
    repositoryMocks.readMarketBatchUnderlyings.mockResolvedValue([]);
    repositoryMocks.readMarketBatchOptions.mockResolvedValue([]);
    repositoryMocks.createMarketBatchSnapshot.mockResolvedValueOnce({
      snapshot_id: "snapshot-building",
      status: "building",
    });

    const staged = await service.stageScoredMarketBatchSnapshot(
      "batch-1",
      request,
    );
    expect(staged.snapshotId).toBe("snapshot-building");
    expect(repositoryMocks.replaceMarketBatchSnapshotCandidates)
      .toHaveBeenCalledOnce();

    repositoryMocks.getMarketBatch.mockResolvedValueOnce({
      ...batch,
      status: "complete",
      summary: {},
    });
    repositoryMocks.createMarketBatchSnapshot.mockResolvedValueOnce({
      snapshot_id: "snapshot-complete",
      status: "complete",
    });
    await service.stageScoredMarketBatchSnapshot("batch-1", request);
    expect(repositoryMocks.replaceMarketBatchSnapshotCandidates)
      .toHaveBeenCalledOnce();

    repositoryMocks.createMarketBatchSnapshot.mockResolvedValueOnce({
      snapshot_id: "snapshot-failed",
      status: "failed",
    });
    await expect(
      service.stageScoredMarketBatchSnapshot("batch-1", request),
    ).rejects.toThrow("snapshot has already failed");

    repositoryMocks.getMarketBatch.mockResolvedValueOnce({
      ...batch,
      status: "running",
    });
    await expect(
      service.stageScoredMarketBatchSnapshot("batch-1", request),
    ).rejects.toThrow("facts are not ready");

    repositoryMocks.publishMarketBatchSnapshot.mockResolvedValueOnce({
      staged: true,
    });
    await expect(
      service.publishScoredMarketBatchSnapshot(staged),
    ).resolves.toEqual({ staged: true });
    await service.finishSharedMarketBatch({
      batchId: "batch-1",
      candidateRowsWritten: 3,
      publicationDurationMs: 4,
      scoringDurationMs: 5,
      snapshotCount: 2,
    });
    await service.markSharedMarketBatchFailed(
      "batch-2",
      new Error("failed"),
    );
    expect(service.sharedMarketBatchDiscoveryFilters([request])).toMatchObject({
      dteMin: 21,
      dteMax: 30,
    });
    expect(repositoryMocks.completeMarketBatch).toHaveBeenCalledWith(
      "batch-1",
      2,
    );
    expect(repositoryMocks.failMarketBatch).toHaveBeenCalledOnce();
  });
});
