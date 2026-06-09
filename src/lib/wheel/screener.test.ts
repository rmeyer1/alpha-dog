import { beforeEach, describe, expect, it, vi } from "vitest";
import { selectCompanyCandidateForStrategy } from "./screener";
import type { WheelAnalysisResponse } from "./types";

const analyzeWheelCandidatesMock = vi.hoisted(() => vi.fn());
const analyzeStagedUniverseWheelCompaniesMock = vi.hoisted(() => vi.fn());
const getWheelAssetUniverseMock = vi.hoisted(() => vi.fn());

vi.mock("./analyze", () => ({
  analyzeWheelCandidates: analyzeWheelCandidatesMock,
}));

vi.mock("./universe-scanner", () => ({
  analyzeStagedUniverseWheelCompanies: analyzeStagedUniverseWheelCompaniesMock,
}));

vi.mock("@/lib/alpaca/client", () => ({
  getWheelAssetUniverse: getWheelAssetUniverseMock,
}));

function responseWithAllStrategies(): WheelAnalysisResponse {
  return {
    ticker: "AAPL",
    underlying: {
      symbol: "AAPL",
      price: 100,
      asOf: "2026-06-06T13:00:00.000Z",
      trend: "neutral",
      rsi14: null,
      movingAverages: {
        ma20: null,
        ma50: null,
        ma200: null,
      },
    },
    persona: {
      id: "balanced_wheel",
      name: "Balanced Wheel",
      motto: "Balanced income.",
    },
    dataFreshness: {
      feed: "demo",
      cacheStatus: "demo",
      asOf: "2026-06-06T13:00:00.000Z",
      nextSuggestedRefreshAt: null,
    },
    shortPuts: [
      {
        score: 10,
        expirationDate: "2026-07-17",
        dte: 41,
        strike: 95,
        premiumYield: 0.02,
        annualizedYield: 0.18,
        delta: -0.24,
        impliedVolatility: 0.35,
        liquidityQuality: "good",
        warnings: [],
      } as never,
    ],
    coveredCalls: [
      {
        score: 99,
        expirationDate: "2026-07-17",
        dte: 41,
        strike: 105,
        premiumYield: 0.03,
        annualizedYield: 0.24,
        delta: 0.25,
        impliedVolatility: 0.38,
        liquidityQuality: "excellent",
        warnings: [],
      } as never,
    ],
    putCreditSpreads: [
      {
        score: 88,
        expirationDate: "2026-07-17",
        dte: 41,
        shortLeg: { strike: 95 },
        longLeg: { strike: 90 },
        returnOnRisk: 0.18,
        annualizedReturnOnRisk: 1.6,
        shortDelta: -0.24,
        impliedVolatility: 0.34,
        liquidityQuality: "acceptable",
        warnings: [],
      } as never,
    ],
    callCreditSpreads: [
      {
        score: 77,
        expirationDate: "2026-07-17",
        dte: 41,
        shortLeg: { strike: 105 },
        longLeg: { strike: 110 },
        returnOnRisk: 0.16,
        annualizedReturnOnRisk: 1.4,
        shortDelta: 0.24,
        impliedVolatility: 0.36,
        liquidityQuality: "good",
        warnings: [],
      } as never,
    ],
    warnings: [],
    errors: [],
  };
}

function responseForTicker(ticker: string): WheelAnalysisResponse {
  const response = responseWithAllStrategies();

  return {
    ...response,
    ticker,
    underlying: {
      ...response.underlying,
      symbol: ticker,
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  analyzeWheelCandidatesMock.mockReset();
  analyzeStagedUniverseWheelCompaniesMock.mockReset();
  getWheelAssetUniverseMock.mockReset();
});

describe("wheel company screener", () => {
  it("selects only the requested strategy family", () => {
    const response = responseWithAllStrategies();

    expect(
      selectCompanyCandidateForStrategy(response, "short_put"),
    ).toMatchObject({
      strategy: "short_put",
      score: 10,
    });
    expect(
      selectCompanyCandidateForStrategy(response, "put_credit_spread"),
    ).toMatchObject({
      strategy: "put_credit_spread",
      score: 88,
    });
    expect(
      selectCompanyCandidateForStrategy(response, "covered_call"),
    ).toMatchObject({
      strategy: "covered_call",
      score: 99,
    });
    expect(
      selectCompanyCandidateForStrategy(response, "call_credit_spread"),
    ).toMatchObject({
      strategy: "call_credit_spread",
      score: 77,
    });
  });

  it("delegates live first-page scans to the staged universe scanner", async () => {
    vi.stubEnv("USE_DEMO_DATA", "false");
    vi.stubEnv("APCA_API_KEY_ID", "key");
    vi.stubEnv("APCA_API_SECRET_KEY", "secret");
    vi.stubEnv("ALPACA_OPTIONS_FEED", "indicative");
    vi.stubEnv("WHEEL_SCREENER_LIVE_BATCH_SIZE", "32");
    vi.stubEnv("WHEEL_SCREENER_LIVE_CONCURRENCY", "8");

    analyzeStagedUniverseWheelCompaniesMock.mockResolvedValue({
      ...responseForTicker("AAPL"),
      companies: [],
      screenedCount: 40,
      skippedCount: 40,
      progress: {
        status: "complete",
        resultScope: "complete",
        cursor: 0,
        nextCursor: null,
        batchSize: 32,
        batchScreenedCount: 32,
        processedCount: 40,
        totalCount: 40,
      },
    });

    const { analyzeTopWheelCompanies } = await import("./screener");
    const response = await analyzeTopWheelCompanies({
      persona: "balanced_wheel",
      strategy: "short_put",
      forceRefresh: true,
    });

    expect(analyzeStagedUniverseWheelCompaniesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        batchSize: 32,
        cursor: 0,
        limit: 50,
        strategy: "short_put",
      }),
    );
    expect(analyzeWheelCandidatesMock).not.toHaveBeenCalled();
    expect(response.progress.resultScope).toBe("complete");
  });
});
