import { describe, expect, it } from "vitest";
import type { AlpacaStockSnapshot } from "@/lib/alpaca/client";
import {
  mapWithConcurrency,
  rankUnderlyingUniverse,
  selectDeepScanCoverageBatch,
  selectDeepScanUniverse,
  stableStringify,
  technicalFromBars,
} from "./domain";
import type {
  DeepScanCoverageRow,
  RankedUnderlying,
  ScannerAsset,
} from "./model";

function stockSnapshot(
  price: number,
  volume: number,
  previousClose = price,
): AlpacaStockSnapshot {
  return {
    dailyBar: {
      c: price,
      h: price,
      l: price,
      o: price,
      t: "2026-06-08T20:00:00.000Z",
      v: volume,
    },
    latestTrade: {
      p: price,
      t: "2026-06-08T20:00:00.000Z",
    },
    prevDailyBar: {
      c: previousClose,
      h: previousClose,
      l: previousClose,
      o: previousClose,
      t: "2026-06-07T20:00:00.000Z",
      v: volume,
    },
  };
}

function ranked(symbol: string, score: number): RankedUnderlying {
  const snapshot = stockSnapshot(100, 1_000_000);

  return {
    asset: {
      exchange: "NASDAQ",
      name: symbol,
      symbol,
    },
    dollarVolume: 100_000_000,
    pctChange: 0,
    price: 100,
    snapshot,
    stockScore: score,
  };
}

describe("universe scanner pure domain", () => {
  it("canonicalizes nested filter objects independent of key order", () => {
    expect(
      stableStringify({
        z: [{ b: 2, a: 1 }],
        a: { d: 4, c: 3 },
      }),
    ).toBe('{"a":{"c":3,"d":4},"z":[{"a":1,"b":2}]}');
  });

  it("preserves input order while enforcing mapper concurrency", async () => {
    let active = 0;
    let peak = 0;

    const results = await mapWithConcurrency([30, 5, 15, 1], 2, async (ms) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, ms));
      active -= 1;
      return ms * 2;
    });

    expect(results).toEqual([60, 10, 30, 2]);
    expect(peak).toBe(2);
  });

  it("filters ineligible assets and ranks eligible snapshots deterministically", () => {
    const assets: ScannerAsset[] = [
      { exchange: "NASDAQ", name: "Alpha", symbol: "AAA" },
      { exchange: "NYSE", name: "Beta", symbol: "BBB" },
      { exchange: "NASDAQ", name: "Cheap", symbol: "CCC" },
      { exchange: "NYSE", name: "Illiquid", symbol: "DDD" },
    ];

    expect(
      rankUnderlyingUniverse(assets, {
        AAA: stockSnapshot(100, 1_000_000, 90),
        BBB: stockSnapshot(50, 1_000_000, 50),
        CCC: stockSnapshot(4, 5_000_000, 4),
        DDD: stockSnapshot(100, 99_999, 100),
      }).map((item) => item.asset.symbol),
    ).toEqual(["AAA", "BBB"]);
  });

  it("combines primary, previous-winner, and rotating discovery slices", () => {
    const candidates = Array.from({ length: 20 }, (_, index) =>
      ranked(`S${index.toString().padStart(2, "0")}`, 100 - index),
    );

    const selected = selectDeepScanUniverse(
      candidates,
      10,
      ["S15", "S16"],
      new Date("2026-06-08T16:00:00.000Z"),
    );

    expect(selected).toHaveLength(10);
    expect(selected.slice(0, 8).map((item) => item.asset.symbol)).toEqual(
      Array.from(
        { length: 8 },
        (_, index) => `S${index.toString().padStart(2, "0")}`,
      ),
    );
    expect(selected.map((item) => item.asset.symbol)).toContain("S15");
  });

  it("calculates technicals from bars without provider or framework mocks", () => {
    const bars = Array.from({ length: 220 }, (_, index) => ({
      c: 80 + index,
      h: 81 + index,
      l: 79 + index,
      o: 80 + index,
      t: `2026-01-${String((index % 28) + 1).padStart(2, "0")}T20:00:00Z`,
      v: 1_000_000,
    }));

    expect(
      technicalFromBars("AAA", 300, bars, new Date("2026-06-08T16:00:00.000Z")),
    ).toMatchObject({
      calculated_at: "2026-06-08T16:00:00.000Z",
      last_bar_at: bars.at(-1)?.t,
      ma20: 289.5,
      ma50: 274.5,
      ma200: 199.5,
      rsi14: 100,
      symbol: "AAA",
      trend: "bullish",
    });
  });

  it("prioritizes never-scanned then oldest stale coverage", () => {
    const coverage = new Map<string, DeepScanCoverageRow>([
      [
        "AAA",
        {
          best_score: 1,
          error: null,
          last_scanned_at: "2026-06-08T15:45:00.000Z",
          option_contract_count: 1,
          status: "complete",
          symbol: "AAA",
        },
      ],
      [
        "BBB",
        {
          best_score: 1,
          error: null,
          last_scanned_at: "2026-06-07T15:00:00.000Z",
          option_contract_count: 1,
          status: "complete",
          symbol: "BBB",
        },
      ],
    ]);

    const selected = selectDeepScanCoverageBatch(
      [ranked("AAA", 100), ranked("BBB", 90), ranked("CCC", 80)],
      coverage,
      3,
      new Date("2026-06-08T15:30:00.000Z").getTime(),
      false,
    );

    expect(selected.map((item) => item.asset.symbol)).toEqual(["CCC", "BBB"]);
  });
});
