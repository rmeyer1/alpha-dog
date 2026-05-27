import { describe, expect, it } from "vitest";
import { buildCandidate } from "./calculations";
import { getPersona, mergeFilters } from "./personas";
import { scoreCandidate } from "./scoring";
import type { RawOptionContract, UnderlyingContext } from "./types";

const bearishUnderlying: UnderlyingContext = {
  symbol: "TEST",
  price: 100,
  asOf: "2026-05-27T16:00:00.000Z",
  trend: "bearish",
  rsi14: 42,
  movingAverages: {
    ma20: 103,
    ma50: 105,
    ma200: 107,
  },
};

const riskyPut: RawOptionContract = {
  contractSymbol: "TEST260619P00090000",
  optionType: "put",
  strike: 90,
  expirationDate: "2026-06-19",
  bid: 1.45,
  ask: 1.55,
  delta: -0.32,
  theta: -0.08,
  impliedVolatility: 0.82,
  volume: 30,
  openInterest: 80,
};

describe("wheel scoring", () => {
  it("adds scoring breakdowns and warnings for risky short puts", () => {
    const filters = mergeFilters("balanced_wheel");
    const candidate = buildCandidate(
      riskyPut,
      bearishUnderlying,
      filters,
      new Date("2026-05-27T12:00:00-04:00"),
    );

    expect(candidate).not.toBeNull();

    const scored = scoreCandidate(
      candidate!,
      getPersona("balanced_wheel"),
      filters,
      bearishUnderlying,
    );

    expect(scored.score).toBeGreaterThan(0);
    expect(scored.scoreBreakdown).toMatchObject({
      eventRisk: 90,
      assignmentQuality: 38,
      volatilityRisk: 54,
    });
    expect(scored.warnings.map((warning) => warning.type)).toEqual(
      expect.arrayContaining(["liquidity", "volatility", "trend"]),
    );
  });

  it("applies persona filter defaults before scoring", () => {
    const conservativeFilters = mergeFilters("conservative_wheel");
    const balancedFilters = mergeFilters("balanced_wheel");

    expect(conservativeFilters.excludeEarnings).toBe(true);
    expect(balancedFilters.excludeEarnings).toBe(false);

    const conservativeCandidate = buildCandidate(
      riskyPut,
      bearishUnderlying,
      conservativeFilters,
      new Date("2026-05-27T12:00:00-04:00"),
    );
    const balancedCandidate = buildCandidate(
      riskyPut,
      bearishUnderlying,
      balancedFilters,
      new Date("2026-05-27T12:00:00-04:00"),
    );

    expect(conservativeCandidate).not.toBeNull();
    expect(balancedCandidate).not.toBeNull();

    const conservativeScore = scoreCandidate(
      conservativeCandidate!,
      getPersona("conservative_wheel"),
      conservativeFilters,
      bearishUnderlying,
    );
    const balancedScore = scoreCandidate(
      balancedCandidate!,
      getPersona("balanced_wheel"),
      balancedFilters,
      bearishUnderlying,
    );

    expect(conservativeScore.scoreBreakdown.eventRisk).toBe(82);
    expect(balancedScore.scoreBreakdown.eventRisk).toBe(90);
  });
});
