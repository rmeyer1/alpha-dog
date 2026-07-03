import { describe, expect, it } from "vitest";
import type {
  VerticalSpreadCandidate,
  WheelCandidate,
} from "@/lib/wheel/types";
import type { CandidateAnalysisContext } from "./types";
import { buildSimulatedPositionInput } from "./add-position-modal";

const analysisContext: CandidateAnalysisContext = {
  dataFreshness: { status: "fresh" },
  filters: { dteMin: 20 },
  persona: {
    id: "balanced_wheel",
    motto: "Balanced",
    name: "Balanced",
  },
  source: "wheel_dashboard",
  ticker: "aapl",
  underlying: {
    asOf: "2026-07-03T20:00:00.000Z",
    movingAverages: {
      ma20: 200,
      ma50: 195,
      ma200: 180,
    },
    price: 201.25,
    rsi14: 55,
    symbol: "AAPL",
    trend: "neutral",
  },
};

const singleLegCandidate = {
  annualizedYield: 0.22,
  ask: 1.3,
  bid: 1.2,
  contractSymbol: "AAPL260821P00190000",
  delta: -0.28,
  distanceFromSpotPct: 0.05,
  dte: 49,
  expirationDate: "2026-08-21",
  impliedVolatility: 0.31,
  liquidityQuality: "good",
  midpoint: 1.25,
  openInterest: 300,
  optionType: "put",
  premiumYield: 0.0065,
  rank: 1,
  score: 82,
  scoreBreakdown: {},
  spread: 0.1,
  spreadPctOfMid: 0.08,
  strike: 190,
  theta: -0.04,
  volume: 120,
  warnings: [],
} as WheelCandidate;

const spreadCandidate = {
  annualizedReturnOnRisk: 0.28,
  breakeven: 188.75,
  definedRiskQuality: "good",
  distanceFromSpotPct: 0.05,
  dte: 49,
  expirationDate: "2026-08-21",
  id: "AAPL-260821-190-180-put",
  impliedVolatility: 0.32,
  liquidityQuality: "good",
  longLeg: {
    ask: 0.8,
    bid: 0.7,
    contractSymbol: "AAPL260821P00180000",
    delta: -0.18,
    impliedVolatility: 0.33,
    midpoint: 0.75,
    openInterest: 260,
    strike: 180,
    theta: -0.03,
    volume: 80,
  },
  maxLoss: 875,
  netCredit: 1.25,
  netDelta: -0.1,
  netTheta: -0.01,
  openInterest: 260,
  optionType: "put",
  rank: 2,
  returnOnRisk: 0.14,
  score: 78,
  scoreBreakdown: {},
  shortDelta: -0.28,
  shortLeg: {
    ask: 2.05,
    bid: 1.95,
    contractSymbol: "AAPL260821P00190000",
    delta: -0.28,
    impliedVolatility: 0.31,
    midpoint: 2,
    openInterest: 300,
    strike: 190,
    theta: -0.04,
    volume: 120,
  },
  spreadPctOfCredit: 0.08,
  strategy: "put_credit_spread",
  volume: 80,
  warnings: [],
  width: 10,
} as VerticalSpreadCandidate;

describe("buildSimulatedPositionInput", () => {
  it("builds a single-leg payload from a candidate and form values", () => {
    const input = buildSimulatedPositionInput({
      analysisContext,
      contracts: 2,
      notes: "Watch assignment risk",
      openedAt: "2026-07-03",
      openPrice: 1.35,
      request: {
        candidate: singleLegCandidate,
        candidateType: "contract",
        strategy: "short_put",
      },
      strategyType: "short_put",
    });

    expect(input).toMatchObject({
      contracts: 2,
      expirationDate: "2026-08-21",
      netCredit: 1.35,
      notes: "Watch assignment risk",
      openedAt: "2026-07-03",
      strategyType: "short_put",
      symbol: "aapl",
      underlyingPriceAtOpen: 201.25,
    });
    expect(input.legs).toHaveLength(1);
    expect(input.legs[0]).toMatchObject({
      contractSymbol: "AAPL260821P00190000",
      openPrice: 1.35,
      optionType: "put",
      side: "short",
      strike: 190,
    });
  });

  it("builds a vertical spread payload with both legs and edited net credit", () => {
    const input = buildSimulatedPositionInput({
      analysisContext,
      contracts: 1,
      notes: "",
      openedAt: "2026-07-03",
      openPrice: 1.4,
      request: {
        candidate: spreadCandidate,
        candidateType: "vertical_spread",
        strategy: "put_credit_spread",
      },
      strategyType: "put_credit_spread",
    });

    expect(input).toMatchObject({
      contracts: 1,
      expirationDate: "2026-08-21",
      netCredit: 1.4,
      openedAt: "2026-07-03",
      strategyType: "put_credit_spread",
      symbol: "aapl",
    });
    expect(input.notes).toBeUndefined();
    expect(input.legs).toHaveLength(2);
    expect(input.legs[0]).toMatchObject({
      contractSymbol: "AAPL260821P00190000",
      openPrice: 2,
      side: "short",
      strike: 190,
    });
    expect(input.legs[1]).toMatchObject({
      contractSymbol: "AAPL260821P00180000",
      openPrice: 0.75,
      side: "long",
      strike: 180,
    });
  });
});
