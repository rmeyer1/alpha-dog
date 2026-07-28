import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeFilters } from "./personas";
import { stableStringify } from "./universe-scanner/domain";

const getHistoricalDailyBarsBySymbolsMock = vi.hoisted(() => vi.fn());
const getLiveOptionSnapshotContractsBySymbolsMock = vi.hoisted(() => vi.fn());
const getLiveOptionSnapshotContractsMock = vi.hoisted(() => vi.fn());
const getStockSnapshotsBySymbolsMock = vi.hoisted(() => vi.fn());
const getWheelAssetUniverseMock = vi.hoisted(() => vi.fn());
const requestSupabaseRestMock = vi.hoisted(() => vi.fn());
const getSupabaseServiceConfigMock = vi.hoisted(() => vi.fn());

function scannerLeaseRpcResult(table: string) {
  if (table === "rpc/acquire_wheel_scan_lease") {
    return {
      acquired: true,
      expires_at: "2026-06-08T17:00:00.000Z",
      owner_id: "11111111-1111-1111-1111-111111111111",
      retry_after_seconds: 0,
    };
  }

  if (table === "rpc/heartbeat_wheel_scan_lease") {
    return {
      expires_at: "2026-06-08T17:00:00.000Z",
      renewed: true,
    };
  }

  if (table === "rpc/release_wheel_scan_lease") {
    return true;
  }

  return undefined;
}

function balancedLeaseIdentity(scanKind: "universe" | "deep_scan") {
  const filters = mergeFilters("balanced_wheel");
  const filterKey = stableStringify(filters);
  const serializedContext = stableStringify({
    filterKey,
    filters,
    persona: "balanced_wheel",
    strategy: "short_put",
  });
  const digest = createHash("sha256").update(serializedContext).digest("hex");

  return {
    contextKey: `sha256:${digest}`,
    leaseKey: `${scanKind}:${digest}`,
    serializedContext,
  };
}

vi.mock("@/lib/alpaca/client", () => ({
  getHistoricalDailyBarsBySymbols: getHistoricalDailyBarsBySymbolsMock,
  getLiveOptionSnapshotContractsBySymbols:
    getLiveOptionSnapshotContractsBySymbolsMock,
  getLiveOptionSnapshotContracts: getLiveOptionSnapshotContractsMock,
  getStockSnapshotsBySymbols: getStockSnapshotsBySymbolsMock,
  getWheelAssetUniverse: getWheelAssetUniverseMock,
}));

vi.mock("@/lib/supabase/rest", () => ({
  getSupabaseServiceConfig: getSupabaseServiceConfigMock,
  requestSupabaseRest: requestSupabaseRestMock,
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.useFakeTimers();
  vi.setSystemTime("2026-06-08T16:00:00.000Z");
  vi.stubEnv("ALPHA_DOG_DEPLOYMENT_MODE", "development");
  vi.stubEnv("APCA_API_KEY_ID", "alpaca-key");
  vi.stubEnv("APCA_API_SECRET_KEY", "alpaca-secret");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "opra");
  vi.stubEnv("WHEEL_UNIVERSE_DEEP_SCAN_SIZE", "1");
  vi.stubEnv("WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE", "1000");

  getHistoricalDailyBarsBySymbolsMock.mockReset();
  getLiveOptionSnapshotContractsBySymbolsMock.mockReset();
  getLiveOptionSnapshotContractsMock.mockReset();
  getStockSnapshotsBySymbolsMock.mockReset();
  getWheelAssetUniverseMock.mockReset();
  getSupabaseServiceConfigMock.mockReset();
  requestSupabaseRestMock.mockReset();
  getSupabaseServiceConfigMock.mockReturnValue({
    serviceRoleKey: "service-role-key",
    url: "https://alpha-dog.supabase.co",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("staged universe scanner", () => {
  it("refreshes stock snapshots and deeply scans only the shortlist", async () => {
    getWheelAssetUniverseMock.mockResolvedValue([
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" },
      { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ" },
    ]);
    getStockSnapshotsBySymbolsMock.mockResolvedValue({
      AAPL: {
        latestTrade: { p: 100, t: "2026-06-08T15:59:00.000Z" },
        dailyBar: { c: 100, h: 101, l: 99, o: 99, t: "2026-06-08T13:30:00.000Z", v: 2_000_000 },
        prevDailyBar: { c: 98, h: 99, l: 97, o: 97, t: "2026-06-07T13:30:00.000Z", v: 1_000_000 },
      },
      MSFT: {
        latestTrade: { p: 50, t: "2026-06-08T15:59:00.000Z" },
        dailyBar: { c: 50, h: 51, l: 49, o: 49, t: "2026-06-08T13:30:00.000Z", v: 100_000 },
        prevDailyBar: { c: 49, h: 50, l: 48, o: 48, t: "2026-06-07T13:30:00.000Z", v: 100_000 },
      },
    });
    getHistoricalDailyBarsBySymbolsMock.mockResolvedValue({
      AAPL: Array.from({ length: 220 }, (_, index) => ({
        c: 90 + index * 0.05,
        h: 0,
        l: 0,
        o: 0,
        t: "2026-06-05T20:00:00Z",
        v: 1,
      })),
    });
    getLiveOptionSnapshotContractsMock.mockResolvedValue([
      {
        contractSymbol: "AAPL260629P00095000",
        optionType: "put",
        strike: 95,
        expirationDate: "2026-06-29",
        bid: 1,
        ask: 1.1,
        delta: -0.24,
        theta: -0.04,
        impliedVolatility: 0.35,
        volume: 500,
        openInterest: null,
      },
    ]);
    requestSupabaseRestMock.mockImplementation((table, options) => {
      const leaseResult = scannerLeaseRpcResult(table);

      if (leaseResult !== undefined) {
        return Promise.resolve(leaseResult);
      }

      if (table === "wheel_universe_scan_runs" && options?.method === "POST") {
        return Promise.resolve([{ id: "scan-run-id" }]);
      }

      if (table === "wheel_option_candidates") {
        return Promise.resolve([]);
      }

      if (table === "wheel_underlying_technicals" && !options?.method) {
        return Promise.resolve([]);
      }

      return Promise.resolve(null);
    });

    const { analyzeStagedUniverseWheelCompanies } = await import(
      "./universe-scanner"
    );
    const response = await analyzeStagedUniverseWheelCompanies({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
      forceRefresh: true,
    });
    const runPatch = requestSupabaseRestMock.mock.calls.find(
      ([table, options]) =>
        table === "wheel_universe_scan_runs" &&
        options?.method === "PATCH" &&
        options?.body?.status === "complete",
    );
    const leaseAcquire = requestSupabaseRestMock.mock.calls.find(
      ([table]) => table === "rpc/acquire_wheel_scan_lease",
    );
    const expectedLease = balancedLeaseIdentity("universe");

    expect(getStockSnapshotsBySymbolsMock).toHaveBeenCalledWith(
      ["AAPL", "MSFT"],
      expect.objectContaining({ chunkSize: 1000, feed: "sip" }),
    );
    expect(expectedLease.serializedContext).toHaveLength(619);
    expect(leaseAcquire?.[1].body).toMatchObject({
      p_context_key: expectedLease.contextKey,
      p_lease_key: expectedLease.leaseKey,
    });
    expect(expectedLease.contextKey.length).toBeLessThanOrEqual(500);
    expect(getLiveOptionSnapshotContractsMock).toHaveBeenCalledTimes(1);
    expect(getLiveOptionSnapshotContractsMock).toHaveBeenCalledWith(
      "AAPL",
      expect.any(Object),
      "short_put",
      100,
      "opra",
    );
    expect(response).toMatchObject({
      dataFreshness: {
        feed: "opra",
        cacheStatus: "fresh",
      },
      companies: [
        {
          ticker: "AAPL",
          exchange: "NASDAQ",
          bestCandidate: {
            strategy: "short_put",
            shortStrike: 95,
          },
        },
      ],
      progress: {
        status: "complete",
        resultScope: "complete",
        batchScreenedCount: 1,
        totalCount: 2,
      },
    });
    expect(runPatch?.[1].body.summary).toMatchObject({
      contracts: {
        contractsMissingOpenInterest: 1,
        contractsReturned: 1,
        fullDiscoverySymbols: 1,
        optionSnapshotRows: 1,
      },
      scoring: {
        noCandidateCount: 0,
        scoredCount: 1,
        skippedCount: 1,
      },
      technicals: {
        refreshedCount: 1,
        requestedCount: 1,
      },
      universe: {
        assetCount: 2,
        rankedCount: 2,
        selectedDeepScanCount: 1,
      },
    });
  });

  it("refreshes known candidate contracts before falling back to full chains", async () => {
    getWheelAssetUniverseMock.mockResolvedValue([
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" },
    ]);
    getStockSnapshotsBySymbolsMock.mockResolvedValue({
      AAPL: {
        latestTrade: { p: 100, t: "2026-06-08T15:59:00.000Z" },
        dailyBar: { c: 100, h: 101, l: 99, o: 99, t: "2026-06-08T13:30:00.000Z", v: 2_000_000 },
        prevDailyBar: { c: 98, h: 99, l: 97, o: 97, t: "2026-06-07T13:30:00.000Z", v: 1_000_000 },
      },
    });
    getHistoricalDailyBarsBySymbolsMock.mockResolvedValue({
      AAPL: Array.from({ length: 220 }, (_, index) => ({
        c: 90 + index * 0.05,
        h: 0,
        l: 0,
        o: 0,
        t: "2026-06-05T20:00:00Z",
        v: 1,
      })),
    });
    getLiveOptionSnapshotContractsBySymbolsMock.mockResolvedValue([
      {
        contractSymbol: "AAPL260629P00095000",
        optionType: "put",
        strike: 95,
        expirationDate: "2026-06-29",
        bid: 1,
        ask: 1.1,
        delta: -0.24,
        theta: -0.04,
        impliedVolatility: 0.35,
        volume: 500,
        openInterest: null,
      },
    ]);
    requestSupabaseRestMock.mockImplementation((table, options) => {
      const leaseResult = scannerLeaseRpcResult(table);

      if (leaseResult !== undefined) {
        return Promise.resolve(leaseResult);
      }

      if (table === "wheel_universe_scan_runs" && options?.method === "POST") {
        return Promise.resolve([{ id: "scan-run-id" }]);
      }

      if (table === "wheel_deep_scan_candidates" && !options?.method) {
        return Promise.resolve([
          {
            symbol: "AAPL",
            option_type: "put",
            expiration: "2026-06-29",
            short_strike: "95",
            long_strike: null,
            as_of: "2026-06-08T15:45:00.000Z",
          },
        ]);
      }

      if (table === "wheel_underlying_technicals" && !options?.method) {
        return Promise.resolve([]);
      }

      return Promise.resolve(null);
    });

    const { analyzeStagedUniverseWheelCompanies } = await import(
      "./universe-scanner"
    );
    const response = await analyzeStagedUniverseWheelCompanies({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
      forceRefresh: true,
    });

    expect(getLiveOptionSnapshotContractsBySymbolsMock).toHaveBeenCalledWith(
      [
        {
          contractSymbol: "AAPL260629P00095000",
          expirationDate: "2026-06-29",
          openInterest: null,
          optionType: "put",
          strike: 95,
        },
      ],
      "opra",
    );
    expect(getLiveOptionSnapshotContractsMock).not.toHaveBeenCalled();
    expect(response.companies[0].ticker).toBe("AAPL");
  });

  it("deep scans a due background coverage batch", async () => {
    vi.stubEnv("WHEEL_UNIVERSE_BACKGROUND_BATCH_SIZE", "1");
    vi.stubEnv("WHEEL_UNIVERSE_BACKGROUND_COVERAGE_MAX_AGE_HOURS", "24");
    getWheelAssetUniverseMock.mockResolvedValue([
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" },
      { symbol: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ" },
    ]);
    getStockSnapshotsBySymbolsMock.mockResolvedValue({
      AAPL: {
        latestTrade: { p: 100, t: "2026-06-08T15:59:00.000Z" },
        dailyBar: { c: 100, h: 101, l: 99, o: 99, t: "2026-06-08T13:30:00.000Z", v: 2_000_000 },
        prevDailyBar: { c: 98, h: 99, l: 97, o: 97, t: "2026-06-07T13:30:00.000Z", v: 1_000_000 },
      },
      MSFT: {
        latestTrade: { p: 50, t: "2026-06-08T15:59:00.000Z" },
        dailyBar: { c: 50, h: 51, l: 49, o: 49, t: "2026-06-08T13:30:00.000Z", v: 100_000 },
        prevDailyBar: { c: 49, h: 50, l: 48, o: 48, t: "2026-06-07T13:30:00.000Z", v: 100_000 },
      },
    });
    getHistoricalDailyBarsBySymbolsMock.mockResolvedValue({
      AAPL: Array.from({ length: 220 }, (_, index) => ({
        c: 90 + index * 0.05,
        h: 0,
        l: 0,
        o: 0,
        t: "2026-06-05T20:00:00Z",
        v: 1,
      })),
    });
    getLiveOptionSnapshotContractsMock.mockResolvedValue([
      {
        contractSymbol: "AAPL260629P00095000",
        optionType: "put",
        strike: 95,
        expirationDate: "2026-06-29",
        bid: 1,
        ask: 1.1,
        delta: -0.24,
        theta: -0.04,
        impliedVolatility: 0.35,
        volume: 500,
        openInterest: null,
      },
    ]);
    requestSupabaseRestMock.mockImplementation((table, options) => {
      const leaseResult = scannerLeaseRpcResult(table);

      if (leaseResult !== undefined) {
        return Promise.resolve(leaseResult);
      }

      if (table === "wheel_deep_scan_runs" && options?.method === "POST") {
        return Promise.resolve([{ id: "deep-run-id" }]);
      }

      if (table === "wheel_deep_scan_coverage" && !options?.method) {
        return Promise.resolve([]);
      }

      if (table === "wheel_option_candidates") {
        return Promise.resolve([]);
      }

      if (table === "wheel_underlying_technicals" && !options?.method) {
        return Promise.resolve([]);
      }

      return Promise.resolve(null);
    });

    const { runUniverseDeepScanCoverage } = await import(
      "./universe-scanner"
    );
    const response = await runUniverseDeepScanCoverage({
      persona: "balanced_wheel",
      strategy: "short_put",
      batchSize: 1,
    });
    const leaseAcquire = requestSupabaseRestMock.mock.calls.find(
      ([table]) => table === "rpc/acquire_wheel_scan_lease",
    );
    const expectedLease = balancedLeaseIdentity("deep_scan");

    expect(getLiveOptionSnapshotContractsMock).toHaveBeenCalledTimes(1);
    expect(expectedLease.serializedContext).toHaveLength(619);
    expect(leaseAcquire?.[1].body).toMatchObject({
      p_context_key: expectedLease.contextKey,
      p_lease_key: expectedLease.leaseKey,
    });
    expect(expectedLease.contextKey.length).toBeLessThanOrEqual(500);
    expect(getLiveOptionSnapshotContractsMock).toHaveBeenCalledWith(
      "AAPL",
      expect.any(Object),
      "short_put",
      100,
      "opra",
    );
    expect(response).toMatchObject({
      runId: "deep-run-id",
      scannedCount: 1,
      candidateCount: 1,
      scannedSymbols: ["AAPL"],
    });
    expect(
      requestSupabaseRestMock.mock.calls.some(([table, options]) =>
        table === "wheel_deep_scan_candidates" && options?.method === "POST"
      ),
    ).toBe(true);
    expect(
      requestSupabaseRestMock.mock.calls.some(([table, options]) =>
        table === "wheel_deep_scan_coverage" && options?.method === "POST"
      ),
    ).toBe(true);
  });

  it("refreshes known background contracts and incrementally discovers updates", async () => {
    vi.stubEnv("WHEEL_UNIVERSE_BACKGROUND_BATCH_SIZE", "1");
    vi.stubEnv("WHEEL_UNIVERSE_BACKGROUND_COVERAGE_MAX_AGE_HOURS", "24");
    getWheelAssetUniverseMock.mockResolvedValue([
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" },
    ]);
    getStockSnapshotsBySymbolsMock.mockResolvedValue({
      AAPL: {
        latestTrade: { p: 100, t: "2026-06-08T15:59:00.000Z" },
        dailyBar: { c: 100, h: 101, l: 99, o: 99, t: "2026-06-08T13:30:00.000Z", v: 2_000_000 },
        prevDailyBar: { c: 98, h: 99, l: 97, o: 97, t: "2026-06-07T13:30:00.000Z", v: 1_000_000 },
      },
    });
    getHistoricalDailyBarsBySymbolsMock.mockResolvedValue({
      AAPL: Array.from({ length: 220 }, (_, index) => ({
        c: 90 + index * 0.05,
        h: 0,
        l: 0,
        o: 0,
        t: "2026-06-05T20:00:00Z",
        v: 1,
      })),
    });
    getLiveOptionSnapshotContractsBySymbolsMock.mockResolvedValue([
      {
        contractSymbol: "AAPL260629P00095000",
        optionType: "put",
        strike: 95,
        expirationDate: "2026-06-29",
        bid: 1,
        ask: 1.1,
        delta: -0.24,
        theta: -0.04,
        impliedVolatility: 0.35,
        volume: 500,
        openInterest: 750,
      },
    ]);
    getLiveOptionSnapshotContractsMock.mockResolvedValue([
      {
        contractSymbol: "AAPL260629P00094000",
        optionType: "put",
        strike: 94,
        expirationDate: "2026-06-29",
        bid: 0.8,
        ask: 0.9,
        delta: -0.2,
        theta: -0.03,
        impliedVolatility: 0.34,
        volume: 200,
        openInterest: 500,
      },
    ]);
    requestSupabaseRestMock.mockImplementation((table, options) => {
      const leaseResult = scannerLeaseRpcResult(table);

      if (leaseResult !== undefined) {
        return Promise.resolve(leaseResult);
      }

      if (table === "wheel_deep_scan_runs" && options?.method === "POST") {
        return Promise.resolve([{ id: "deep-run-id" }]);
      }

      if (table === "wheel_deep_scan_coverage" && !options?.method) {
        return Promise.resolve([
          {
            best_score: 80,
            error: null,
            last_scanned_at: "2026-06-08T14:00:00.000Z",
            option_contract_count: 1,
            status: "complete",
            symbol: "AAPL",
          },
        ]);
      }

      if (table === "wheel_deep_scan_candidates" && !options?.method) {
        return Promise.resolve([
          {
            symbol: "AAPL",
            option_type: "put",
            expiration: "2026-06-29",
            short_strike: "95",
            long_strike: null,
            as_of: "2026-06-08T15:45:00.000Z",
          },
        ]);
      }

      if (table === "wheel_underlying_technicals" && !options?.method) {
        return Promise.resolve([]);
      }

      return Promise.resolve(null);
    });

    const { runUniverseDeepScanCoverage } = await import(
      "./universe-scanner"
    );
    const response = await runUniverseDeepScanCoverage({
      persona: "balanced_wheel",
      strategy: "short_put",
      batchSize: 1,
      forceRefresh: true,
    });
    const coveragePost = requestSupabaseRestMock.mock.calls.find(
      ([table, options]) =>
        table === "wheel_deep_scan_coverage" && options?.method === "POST",
    );
    const runPatch = requestSupabaseRestMock.mock.calls.find(
      ([table, options]) =>
        table === "wheel_deep_scan_runs" &&
        options?.method === "PATCH" &&
        options?.body?.status === "complete",
    );

    expect(getLiveOptionSnapshotContractsBySymbolsMock).toHaveBeenCalledWith(
      [
        {
          contractSymbol: "AAPL260629P00095000",
          expirationDate: "2026-06-29",
          openInterest: null,
          optionType: "put",
          strike: 95,
        },
      ],
      "opra",
    );
    expect(getLiveOptionSnapshotContractsMock).toHaveBeenCalledWith(
      "AAPL",
      expect.any(Object),
      "short_put",
      100,
      "opra",
      { updatedSince: "2026-06-08T14:00:00.000Z" },
    );
    expect(coveragePost?.[1].body[0]).toMatchObject({
      option_contract_count: 2,
      status: "complete",
      symbol: "AAPL",
    });
    expect(response).toMatchObject({
      candidateCount: 1,
      scannedSymbols: ["AAPL"],
    });
    expect(runPatch?.[1].body.summary).toMatchObject({
      contracts: {
        contractsMissingOpenInterest: 0,
        contractsReturned: 2,
        discoveryContractsReturned: 1,
        incrementalDiscoverySymbols: 1,
        knownContractsRequested: 1,
        knownContractsReturned: 1,
        optionSnapshotRows: 2,
      },
      coverage: {
        failedCount: 0,
        noCandidateCount: 0,
        updatedCount: 1,
      },
      selection: {
        batchSize: 1,
        selectedCount: 1,
        totalEligibleCount: 1,
      },
    });
  });

  it("does not start provider work when an active universe owner holds the interval lease", async () => {
    requestSupabaseRestMock.mockImplementation((table) => {
      if (table === "rpc/acquire_wheel_scan_lease") {
        return Promise.resolve({
          acquired: false,
          expires_at: "2026-06-08T17:00:00.000Z",
          owner_id: "22222222-2222-2222-2222-222222222222",
          retry_after_seconds: 90,
        });
      }

      return Promise.resolve(null);
    });
    const { analyzeStagedUniverseWheelCompanies } = await import(
      "./universe-scanner"
    );

    await expect(
      analyzeStagedUniverseWheelCompanies({
        persona: "balanced_wheel",
        strategy: "short_put",
      }),
    ).rejects.toThrow("already active");
    expect(getWheelAssetUniverseMock).not.toHaveBeenCalled();
    expect(getStockSnapshotsBySymbolsMock).not.toHaveBeenCalled();
  });

  it("reports a duplicate deep-scan trigger as skipped before provider work", async () => {
    requestSupabaseRestMock.mockImplementation((table) => {
      if (table === "rpc/acquire_wheel_scan_lease") {
        return Promise.resolve({
          acquired: false,
          expires_at: "2026-06-08T17:00:00.000Z",
          owner_id: "22222222-2222-2222-2222-222222222222",
          retry_after_seconds: 90,
        });
      }

      return Promise.resolve(null);
    });
    const { runUniverseDeepScanCoverage } = await import(
      "./universe-scanner"
    );

    await expect(
      runUniverseDeepScanCoverage({
        persona: "balanced_wheel",
        strategy: "short_put",
      }),
    ).resolves.toMatchObject({
      runId: null,
      scannedCount: 0,
      skippedReason: expect.stringContaining("already active"),
    });
    expect(getWheelAssetUniverseMock).not.toHaveBeenCalled();
    expect(getStockSnapshotsBySymbolsMock).not.toHaveBeenCalled();
  });

  it("reuses a staged checkpoint when the same Workflow step retries", async () => {
    const checkpoint = {
      batchSize: 1,
      candidateCount: 1,
      errorCount: 0,
      errors: [],
      filterKey: "{}",
      persona: "balanced_wheel",
      runId: "deep-run-id",
      scannedCount: 1,
      scannedSymbols: ["AAPL"],
      selectedCount: 1,
      skippedReason: null,
      staleBefore: "2026-06-08T12:00:00.000Z",
      strategy: "short_put",
      totalEligibleCount: 1,
    };
    requestSupabaseRestMock.mockImplementation((table, options) => {
      const leaseResult = scannerLeaseRpcResult(table);

      if (leaseResult !== undefined) {
        return Promise.resolve(leaseResult);
      }

      if (
        table === "wheel_deep_scan_runs" &&
        options?.query?.lease_owner_id
      ) {
        return Promise.resolve([{
          id: "deep-run-id",
          workflow_result: checkpoint,
        }]);
      }

      return Promise.resolve(null);
    });
    const { stageUniverseDeepScanCoverage } = await import(
      "./universe-scanner"
    );

    await expect(
      stageUniverseDeepScanCoverage(
        {
          persona: "balanced_wheel",
          strategy: "short_put",
        },
        "step_retry",
      ),
    ).resolves.toEqual({
      result: null,
      runId: "deep-run-id",
    });

    expect(getWheelAssetUniverseMock).not.toHaveBeenCalled();
    expect(getStockSnapshotsBySymbolsMock).not.toHaveBeenCalled();
    expect(requestSupabaseRestMock).not.toHaveBeenCalledWith(
      "wheel_deep_scan_runs",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestSupabaseRestMock).not.toHaveBeenCalledWith(
      "rpc/release_wheel_scan_lease",
      expect.anything(),
    );
  });
});
