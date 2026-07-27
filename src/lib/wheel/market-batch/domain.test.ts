import { describe, expect, it } from "vitest";
import type {
  MarketBatchOptionRow,
  MarketBatchUnderlyingRow,
} from "./model";
import {
  buildSharedDiscoveryFilters,
  estimateScannerWork,
  marketBatchOptionTypes,
  marketBatchRawContract,
  marketBatchUnderlyingContext,
  scoreMarketBatchConsumer,
} from "./domain";
import type { WheelCompanyStrategy, WheelScreenerRequest } from "../types";

const capturedAt = "2026-07-27T14:00:00.000Z";
const expiration = "2026-08-21";

const underlyingRows: MarketBatchUnderlyingRow[] = [{
  batch_id: "11111111-1111-1111-1111-111111111111",
  captured_at: capturedAt,
  company_name: "Test Company",
  daily_volume: 2_000_000,
  dollar_volume: 200_000_000,
  earnings_as_of: null,
  earnings_context: {
    asOf: null,
    coverageThrough: null,
    events: [],
    providerEnabled: false,
    symbol: "TEST",
  },
  exchange: "NASDAQ",
  latest_trade_at: capturedAt,
  ma20: 98,
  ma50: 95,
  ma200: 90,
  pct_change: 0.01,
  previous_close: 99,
  price: 100,
  rsi14: 58,
  selected_for_scoring: true,
  stock_score: 100,
  stock_snapshot: {},
  symbol: "TEST",
  technical_as_of: capturedAt,
  trend: "bullish",
  universe_rank: 1,
}];

function optionRow({
  ask,
  bid,
  contractSymbol,
  delta,
  optionType,
  strike,
}: {
  ask: number;
  bid: number;
  contractSymbol: string;
  delta: number;
  optionType: "put" | "call";
  strike: number;
}): MarketBatchOptionRow {
  return {
    ask,
    batch_id: underlyingRows[0].batch_id,
    bid,
    captured_at: capturedAt,
    contract_symbol: contractSymbol,
    delta,
    expiration,
    implied_volatility: 0.36,
    open_interest: 1_000,
    option_type: optionType,
    strike,
    theta: -0.06,
    underlying_symbol: "TEST",
    volume: 400,
  };
}

const optionRows = [
  optionRow({
    ask: 2.6,
    bid: 2.5,
    contractSymbol: "TEST260821P00095000",
    delta: -0.24,
    optionType: "put",
    strike: 95,
  }),
  optionRow({
    ask: 1.5,
    bid: 1.4,
    contractSymbol: "TEST260821P00090000",
    delta: -0.14,
    optionType: "put",
    strike: 90,
  }),
  optionRow({
    ask: 2.6,
    bid: 2.5,
    contractSymbol: "TEST260821C00105000",
    delta: 0.24,
    optionType: "call",
    strike: 105,
  }),
  optionRow({
    ask: 1.5,
    bid: 1.4,
    contractSymbol: "TEST260821C00110000",
    delta: 0.14,
    optionType: "call",
    strike: 110,
  }),
];

const requests = (
  [
    "short_put",
    "put_credit_spread",
    "covered_call",
    "call_credit_spread",
  ] as WheelCompanyStrategy[]
).map(
  (strategy): WheelScreenerRequest => ({
    persona: "balanced_wheel",
    strategy,
    limit: 50,
  }),
);

describe("shared market batch domain", () => {
  it("builds one superset discovery envelope for every consumer", () => {
    const filters = buildSharedDiscoveryFilters([
      { persona: "conservative_wheel", strategy: "short_put" },
      { persona: "weekly_theta", strategy: "call_credit_spread" },
    ]);

    expect(filters).toMatchObject({
      dteMin: 7,
      dteMax: 45,
      deltaMin: 0.15,
      deltaMax: 0.3,
      excludeEarnings: false,
      includeWeeklies: true,
      maxSpreadPctOfMid: 0.12,
    });
    expect(marketBatchOptionTypes(requests)).toEqual(["call", "put"]);
  });

  it("rejects empty consumers and invalid persisted financial facts", () => {
    expect(() => buildSharedDiscoveryFilters([])).toThrow(
      "requires at least one scoring consumer",
    );
    expect(() => marketBatchUnderlyingContext({
      ...underlyingRows[0],
      price: "invalid" as never,
    })).toThrow("invalid stock price");
    expect(() => marketBatchUnderlyingContext({
      ...underlyingRows[0],
      price: 0,
    })).toThrow("invalid stock price");

    for (const field of ["strike", "bid", "ask"] as const) {
      expect(() => marketBatchRawContract({
        ...optionRows[0],
        [field]: null,
      })).toThrow("invalid quote fields");
    }
  });

  it("adds consumers without repeating shared market-data ingestion", () => {
    const legacy = estimateScannerWork({
      assetCount: 1_000,
      consumers: requests,
      contractsPerOptionType: 20,
      shared: false,
      symbolCount: 250,
    });
    const shared = estimateScannerWork({
      assetCount: 1_000,
      consumers: requests,
      contractsPerOptionType: 20,
      shared: true,
      symbolCount: 250,
    });
    const sharedWithMorePersonas = estimateScannerWork({
      assetCount: 1_000,
      consumers: [
        ...requests,
        ...requests.map((request) => ({
          ...request,
          persona: "conservative_wheel" as const,
        })),
      ],
      contractsPerOptionType: 20,
      shared: true,
      symbolCount: 250,
    });

    expect(legacy).toEqual({
      databaseRows: 25_000,
      providerRequests: 1_008,
    });
    expect(shared).toEqual({
      databaseRows: 11_250,
      providerRequests: 502,
    });
    expect(sharedWithMorePersonas).toEqual(shared);
  });

  it.each(requests)(
    "preserves representative $strategy financial and ranking output",
    (request) => {
      const result = scoreMarketBatchConsumer({
        feed: "opra",
        now: new Date(capturedAt),
        optionRows,
        request,
        underlyingRows,
      });

      expect({
        company: result.response.companies[0],
        freshness: result.response.dataFreshness,
        progress: result.response.progress,
      }).toMatchSnapshot();
    },
  );

  it("reports indicative-feed warnings, skipped rows, and bounded fact errors", () => {
    const result = scoreMarketBatchConsumer({
      factErrors: Array.from({ length: 30 }, (_, index) => `error-${index}`),
      feed: "indicative",
      now: new Date(capturedAt),
      optionRows: [],
      request: requests[0],
      underlyingRows: [{
        ...underlyingRows[0],
        earnings_context: {
          ...underlyingRows[0].earnings_context,
          providerEnabled: true,
        },
      }, {
        ...underlyingRows[0],
        selected_for_scoring: false,
        symbol: "SKIP",
        universe_rank: 2,
      }],
    });

    expect(result.companies).toEqual([]);
    expect(result.response.errors).toHaveLength(25);
    expect(result.response.skippedCount).toBe(2);
    expect(result.response.warnings).toEqual([
      expect.objectContaining({ type: "data_quality" }),
    ]);
  });

  it("uses current time when a batch has no captured facts", () => {
    const now = new Date("2026-07-27T15:00:00.000Z");
    const result = scoreMarketBatchConsumer({
      feed: "opra",
      now,
      optionRows: [],
      request: requests[0],
      underlyingRows: [],
    });

    expect(result.response.dataFreshness.asOf).toBe(now.toISOString());
    expect(result.response.companies).toEqual([]);
  });
});
