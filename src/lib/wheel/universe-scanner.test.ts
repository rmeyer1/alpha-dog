import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getHistoricalDailyBarsBySymbolsMock = vi.hoisted(() => vi.fn());
const getLiveOptionSnapshotContractsMock = vi.hoisted(() => vi.fn());
const getStockSnapshotsBySymbolsMock = vi.hoisted(() => vi.fn());
const getWheelAssetUniverseMock = vi.hoisted(() => vi.fn());
const requestSupabaseRestMock = vi.hoisted(() => vi.fn());
const getSupabaseServiceConfigMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/alpaca/client", () => ({
  getHistoricalDailyBarsBySymbols: getHistoricalDailyBarsBySymbolsMock,
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
  vi.stubEnv("USE_DEMO_DATA", "false");
  vi.stubEnv("APCA_API_KEY_ID", "alpaca-key");
  vi.stubEnv("APCA_API_SECRET_KEY", "alpaca-secret");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "opra");
  vi.stubEnv("WHEEL_UNIVERSE_DEEP_SCAN_SIZE", "1");
  vi.stubEnv("WHEEL_UNIVERSE_STOCK_SNAPSHOT_CHUNK_SIZE", "1000");

  getHistoricalDailyBarsBySymbolsMock.mockReset();
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

    expect(getStockSnapshotsBySymbolsMock).toHaveBeenCalledWith(
      ["AAPL", "MSFT"],
      expect.objectContaining({ chunkSize: 1000, feed: "sip" }),
    );
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

    expect(getLiveOptionSnapshotContractsMock).toHaveBeenCalledTimes(1);
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
});
