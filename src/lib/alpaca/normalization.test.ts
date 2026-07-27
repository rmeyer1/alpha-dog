import { describe, expect, it } from "vitest";
import {
  classifyAlpacaTrend,
  normalizeAlpacaSnapshotContract,
  parseAlpacaOptionSymbol,
  rsi14,
} from "./normalization";

describe("Alpaca normalization", () => {
  it("parses OCC symbols and normalizes snapshots without provider mocks", () => {
    expect(parseAlpacaOptionSymbol("AAPL260619P00095000")).toMatchObject({
      underlyingSymbol: "AAPL",
      expirationDate: "2026-06-19",
      optionType: "put",
      strike: 95,
    });
    expect(
      normalizeAlpacaSnapshotContract("AAPL260619P00095000", {
        latestQuote: { bp: 1, ap: 1.1 },
      }),
    ).toMatchObject({ optionType: "put", strike: 95 });
  });
  it("calculates indicators and trend classifications", () => {
    expect(rsi14(Array.from({ length: 15 }, (_, index) => index))).toBe(100);
    expect(classifyAlpacaTrend(110, 105, 100, 90)).toBe("bullish");
  });
});
