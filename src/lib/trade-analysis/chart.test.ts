import { describe, expect, it } from "vitest";
import type { AlpacaBar, CompanyProfile } from "@/lib/company-profile";
import type { TradeAnalysisInput } from "./types";
import { buildChartContext } from "./chart";

function makeBars(): AlpacaBar[] {
  const bars: AlpacaBar[] = [];

  for (let index = 0; index < 220; index += 1) {
    const close = 100 + index * 0.45;
    const open = close - 0.2;

    bars.push({
      c: close,
      h: close + 1.4,
      l: close - 1.2,
      o: open,
      t: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T21:00:00.000Z`,
      v: 1_000_000 + index * 1_000,
    });
  }

  return bars;
}

const input: TradeAnalysisInput = {
  candidate: {
    breakeven: 185,
    maxLoss: 390,
    netCredit: 1.1,
    shortLeg: { strike: 186 },
  },
  candidateIdentity: {
    key: "spread-1",
    rank: 1,
    score: 88,
  },
  candidateType: "vertical_spread",
  persona: {
    id: "balanced_wheel",
    motto: "Income with discipline.",
    name: "Balanced Wheel",
  },
  source: "wheel_dashboard",
  strategy: "put_credit_spread",
  ticker: "AAPL",
  underlying: {
    asOf: "2026-06-15T14:30:00.000Z",
    movingAverages: {
      ma20: null,
      ma50: null,
      ma200: null,
    },
    price: 198.55,
    rsi14: null,
    symbol: "AAPL",
    trend: "bullish",
  },
};

const profile: CompanyProfile = {
  market: {
    asOf: "2026-06-15T14:30:00.000Z",
    asset: { name: "Apple Inc.", symbol: "AAPL" },
    bars: makeBars(),
    snapshot: null,
    stats: null,
    status: "available",
  },
  signalScribe: {
    analyses: [],
    company: null,
    filings: [],
    financialFacts: [],
    sections: [],
    status: "not_configured",
  },
  ticker: "AAPL",
};

describe("trade analysis chart context", () => {
  it("builds server-side chart indicators and trade level distances", () => {
    const context = buildChartContext(input, profile);
    const facts = context.facts as {
      momentum: { rsi14: number | null };
      supportResistance: {
        nearestSupport: number | null;
        nearestSupportDistancePct: number | null;
      };
      tradeLevels: {
        breakevenDistancePct: number | null;
        shortStrike: number | null;
      };
      trend: { indicatorTrend: string };
      volatility: { atr14Pct: number | null; realizedVolatility20Day: number | null };
    };

    expect(context.source).toBe("server_chart_indicators");
    expect(facts.momentum.rsi14).toBeGreaterThan(90);
    expect(facts.supportResistance.nearestSupport).not.toBeNull();
    expect(facts.supportResistance.nearestSupportDistancePct).toBeLessThanOrEqual(0);
    expect(facts.tradeLevels.shortStrike).toBe(186);
    expect(facts.tradeLevels.breakevenDistancePct).toBeLessThan(0);
    expect(facts.trend.indicatorTrend).toBe("bullish_alignment");
    expect(facts.volatility.atr14Pct).toBeGreaterThan(0);
    expect(facts.volatility.realizedVolatility20Day).not.toBeNull();
  });
});
