import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RawOptionContract,
  UnderlyingContext,
} from "./types";

const getLiveWheelMarketDataMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/alpaca/client", () => ({
  getLiveWheelMarketData: getLiveWheelMarketDataMock,
}));

const underlying: UnderlyingContext = {
  symbol: "AAPL",
  price: 100,
  asOf: "2026-05-27T16:00:00.000Z",
  trend: "bullish",
  rsi14: 58,
  movingAverages: {
    ma20: 98,
    ma50: 95,
    ma200: 90,
  },
};

const rawContracts: RawOptionContract[] = [
  {
    contractSymbol: "AAPL260619P00095000",
    optionType: "put",
    strike: 95,
    expirationDate: "2026-06-19",
    bid: 1.45,
    ask: 1.55,
    delta: -0.24,
    theta: -0.06,
    impliedVolatility: 0.38,
    volume: 250,
    openInterest: 600,
  },
  {
    contractSymbol: "AAPL260619C00105000",
    optionType: "call",
    strike: 105,
    expirationDate: "2026-06-19",
    bid: 1.2,
    ask: 1.3,
    delta: 0.24,
    theta: -0.05,
    impliedVolatility: 0.35,
    volume: 230,
    openInterest: 540,
  },
];

function liveMarketData(asOf = "2026-05-27T16:00:00.000Z") {
  return {
    feed: "indicative" as const,
    underlying: {
      ...underlying,
      asOf,
    },
    rawContracts,
    asOf,
  };
}

function stubLiveEnv() {
  vi.stubEnv("USE_DEMO_DATA", "false");
  vi.stubEnv("EARNINGS_PROVIDER_ENABLED", "true");
  vi.stubEnv("APCA_API_KEY_ID", "key");
  vi.stubEnv("APCA_API_SECRET_KEY", "secret");
  vi.stubEnv("ALPACA_OPTIONS_FEED", "indicative");
}

async function importAnalyze() {
  const analyzeModule = await import("./analyze");
  const cache = await import("./analysis-cache");

  cache.clearAnalysisCacheForTests();

  return analyzeModule.analyzeWheelCandidates;
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime("2026-05-27T12:00:00-04:00");
  getLiveWheelMarketDataMock.mockReset();
});

describe("wheel analysis", () => {
  it("returns deterministic demo-mode result groups without Alpaca credentials", async () => {
    vi.stubEnv("USE_DEMO_DATA", "true");
    vi.stubEnv("EARNINGS_PROVIDER_ENABLED", "false");

    const analyzeWheelCandidates = await importAnalyze();
    const response = await analyzeWheelCandidates({
      ticker: "aapl",
      persona: "balanced_wheel",
      resultLimit: 5,
    });

    expect(response.ticker).toBe("AAPL");
    expect(response.dataFreshness.cacheStatus).toBe("demo");
    expect(response.dataFreshness.feed).toBe("demo");
    expect(response.shortPuts).toHaveLength(5);
    expect(response.coveredCalls).toHaveLength(5);
    expect(response.putCreditSpreads).toEqual(expect.any(Array));
    expect(response.callCreditSpreads).toEqual(expect.any(Array));
    expect(response.warnings.map((warning) => warning.type)).toEqual(
      expect.arrayContaining(["data_quality", "earnings"]),
    );

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("caches repeated identical live analysis requests", async () => {
    stubLiveEnv();
    getLiveWheelMarketDataMock.mockResolvedValue(liveMarketData());

    const analyzeWheelCandidates = await importAnalyze();
    const first = await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
    });
    const second = await analyzeWheelCandidates({
      ticker: " aapl ",
      persona: "balanced_wheel",
      resultLimit: 5,
    });

    expect(getLiveWheelMarketDataMock).toHaveBeenCalledTimes(1);
    expect(first.dataFreshness.cacheStatus).toBe("fresh");
    expect(second.dataFreshness.cacheStatus).toBe("fresh");
    expect(second.shortPuts).toHaveLength(1);
    expect(second.coveredCalls).toHaveLength(1);

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("limits live analysis to the requested strategy family", async () => {
    stubLiveEnv();
    getLiveWheelMarketDataMock.mockResolvedValue(liveMarketData());

    const analyzeWheelCandidates = await importAnalyze();
    const response = await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
      strategy: "short_put",
    });

    expect(getLiveWheelMarketDataMock).toHaveBeenCalledWith(
      "AAPL",
      expect.any(Object),
      "short_put",
    );
    expect(response.shortPuts).toHaveLength(1);
    expect(response.coveredCalls).toEqual([]);
    expect(response.putCreditSpreads).toEqual([]);
    expect(response.callCreditSpreads).toEqual([]);

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("force refresh bypasses fresh cache and writes a new response", async () => {
    stubLiveEnv();
    getLiveWheelMarketDataMock
      .mockResolvedValueOnce(liveMarketData("2026-05-27T16:00:00.000Z"))
      .mockResolvedValueOnce(liveMarketData("2026-05-27T16:01:00.000Z"));

    const analyzeWheelCandidates = await importAnalyze();
    await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
    });
    const refreshed = await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
      forceRefresh: true,
    });

    expect(getLiveWheelMarketDataMock).toHaveBeenCalledTimes(2);
    expect(refreshed.dataFreshness.asOf).toBe("2026-05-27T16:01:00.000Z");

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("serves stale cached analysis when live refresh fails", async () => {
    stubLiveEnv();
    getLiveWheelMarketDataMock
      .mockResolvedValueOnce(liveMarketData("2026-05-27T16:00:00.000Z"))
      .mockRejectedValueOnce(new Error("Alpaca returned HTTP 429."));

    const analyzeWheelCandidates = await importAnalyze();
    await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
    });

    vi.setSystemTime("2026-05-27T12:03:00-04:00");
    const stale = await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
    });

    expect(getLiveWheelMarketDataMock).toHaveBeenCalledTimes(2);
    expect(stale.dataFreshness.cacheStatus).toBe("stale");
    expect(stale.dataFreshness.nextSuggestedRefreshAt).toBeNull();
    expect(stale.warnings[0]).toMatchObject({
      type: "data_quality",
      severity: "warning",
    });

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("throws live provider errors when no stale cache is available", async () => {
    stubLiveEnv();
    getLiveWheelMarketDataMock.mockRejectedValue(
      new Error("Alpaca returned HTTP 500."),
    );

    const analyzeWheelCandidates = await importAnalyze();

    await expect(
      analyzeWheelCandidates({
        ticker: "AAPL",
        persona: "balanced_wheel",
        resultLimit: 5,
      }),
    ).rejects.toThrow("Alpaca returned HTTP 500.");

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("does not cache demo-mode responses", async () => {
    vi.stubEnv("USE_DEMO_DATA", "true");
    vi.stubEnv("EARNINGS_PROVIDER_ENABLED", "false");

    const analyzeWheelCandidates = await importAnalyze();
    const first = await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
    });
    vi.setSystemTime("2026-05-27T12:01:00-04:00");
    const second = await analyzeWheelCandidates({
      ticker: "AAPL",
      persona: "balanced_wheel",
      resultLimit: 5,
    });

    expect(getLiveWheelMarketDataMock).not.toHaveBeenCalled();
    expect(first.dataFreshness.cacheStatus).toBe("demo");
    expect(second.dataFreshness.cacheStatus).toBe("demo");
    expect(second.dataFreshness.asOf).not.toBe(first.dataFreshness.asOf);

    vi.unstubAllEnvs();
    vi.useRealTimers();
  });
});
