import { describe, expect, it } from "vitest";
import {
  buildCandidate,
  liquidityQuality,
  midpoint,
  premiumYield,
  spread,
} from "./calculations";
import type { RawOptionContract, UnderlyingContext, WheelFilters } from "./types";

const filters: WheelFilters = {
  dteMin: 21,
  dteMax: 30,
  deltaMin: 0.15,
  deltaMax: 0.3,
  minPremiumYield: 0.01,
  minVolume: 50,
  minOpenInterest: 100,
  maxSpreadPctOfMid: 0.2,
  minSpreadReturnOnRisk: 0.2,
  maxSpreadWidth: 10,
  spreadLongLegCount: 3,
  excludeEarnings: false,
  includeWeeklies: true,
};

const underlying: UnderlyingContext = {
  symbol: "TEST",
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

const putContract: RawOptionContract = {
  contractSymbol: "TEST260619P00095000",
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
};

describe("wheel calculations", () => {
  it("calculates quote-derived values", () => {
    expect(midpoint(1.45, 1.55)).toBe(1.5);
    expect(spread(1.45, 1.55)).toBe(0.1);
    expect(premiumYield("put", 1.5, 95, 100)).toBeCloseTo(0.0158, 4);
    expect(premiumYield("call", 1.5, 105, 100)).toBe(0.015);
  });

  it("classifies liquidity from open interest, volume, and spread width", () => {
    expect(liquidityQuality(600, 250, 0.04)).toBe("excellent");
    expect(liquidityQuality(600, 250, 0.08)).toBe("good");
    expect(liquidityQuality(150, 60, 0.18)).toBe("acceptable");
    expect(liquidityQuality(null, 60, 0.04)).toBe("good");
    expect(liquidityQuality(null, 60, 0.18)).toBe("weak");
    expect(liquidityQuality(600, 250, 0.4)).toBe("poor");
  });

  it("builds a ranked input candidate from a valid put contract", () => {
    const candidate = buildCandidate(
      putContract,
      underlying,
      filters,
      new Date("2026-05-27T12:00:00-04:00"),
    );

    expect(candidate).toMatchObject({
      optionType: "put",
      strike: 95,
      dte: 24,
      midpoint: 1.5,
      spread: 0.1,
      breakeven: 93.5,
      assignmentQuality: "excellent",
      liquidityQuality: "good",
    });
    expect(candidate?.premiumYield).toBe(0.0158);
    expect(candidate?.annualizedYield).toBe(0.2401);
  });

  it("rejects contracts outside executable or strategy bounds", () => {
    expect(
      buildCandidate(
        { ...putContract, bid: 1.6, ask: 1.5 },
        underlying,
        filters,
        new Date("2026-05-27T12:00:00-04:00"),
      ),
    ).toBeNull();
    expect(
      buildCandidate(
        { ...putContract, strike: 101 },
        underlying,
        filters,
        new Date("2026-05-27T12:00:00-04:00"),
      ),
    ).toBeNull();
  });
});
