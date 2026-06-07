import { describe, expect, it } from "vitest";
import { selectCompanyCandidateForStrategy } from "./screener";
import type { WheelAnalysisResponse } from "./types";

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
});
