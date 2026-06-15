import { describe, expect, it } from "vitest";
import { tradeAnalysisRequestSchema } from "./validation";

describe("trade analysis validation", () => {
  it("normalizes valid candidate analysis requests", () => {
    const parsed = tradeAnalysisRequestSchema.parse({
      candidate: {
        contractSymbol: "AAPL260116P00180000",
        score: 82,
      },
      candidateIdentity: {
        key: "AAPL260116P00180000",
        rank: 1,
        score: 82,
      },
      candidateType: "contract",
      persona: {
        id: "balanced_wheel",
        motto: "Income with discipline.",
        name: "Balanced Wheel",
      },
      strategy: "short_put",
      ticker: " aapl ",
      underlying: {
        asOf: "2026-06-15T14:30:00.000Z",
        movingAverages: {
          ma20: 190,
          ma50: 185,
          ma200: 170,
        },
        price: 195,
        rsi14: 55,
        symbol: "AAPL",
        trend: "bullish",
      },
    });

    expect(parsed.ticker).toBe("AAPL");
    expect(parsed.source).toBe("wheel_dashboard");
  });

  it("rejects unsupported symbols and verdict payload gaps", () => {
    const parsed = tradeAnalysisRequestSchema.safeParse({
      candidate: {},
      candidateIdentity: {
        key: "bad",
        rank: null,
        score: null,
      },
      candidateType: "contract",
      persona: {
        id: "balanced_wheel",
        motto: "Income with discipline.",
        name: "Balanced Wheel",
      },
      strategy: "short_put",
      ticker: "AAPL!",
      underlying: {
        asOf: "2026-06-15T14:30:00.000Z",
        movingAverages: {
          ma20: null,
          ma50: null,
          ma200: null,
        },
        price: 195,
        rsi14: null,
        symbol: "AAPL",
        trend: "bullish",
      },
    });

    expect(parsed.success).toBe(false);
  });
});
