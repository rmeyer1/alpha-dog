import { beforeEach, describe, expect, it, vi } from "vitest";

const restMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ ALPACA_OPTIONS_FEED: "opra" }),
  isDemoMode: () => false,
}));
vi.mock("@/lib/supabase/rest", () => ({
  requestSupabaseRest: restMock,
}));

beforeEach(() => {
  restMock.mockReset();
});

describe("shared market batch reader", () => {
  it("reconstructs the existing screener response contract from one pointer", async () => {
    restMock
      .mockResolvedValueOnce([{
        batch_id: "batch-1",
        published_at: "2026-07-27T14:05:00.000Z",
        snapshot_id: "snapshot-1",
      }])
      .mockResolvedValueOnce([{
        as_of: "2026-07-27T14:00:00.000Z",
        batch_id: "batch-1",
        candidate_count: 2,
        completed_at: "2026-07-27T14:05:00.000Z",
        errors: [],
        feed: "opra",
        id: "snapshot-1",
        next_suggested_refresh_at: "2026-07-27T14:20:00.000Z",
        screened_count: 250,
        skipped_count: 40,
        started_at: "2026-07-27T14:00:00.000Z",
        status: "complete",
        warnings: [],
      }])
      .mockResolvedValueOnce([{
        annualized_return_on_risk: null,
        annualized_yield: "0.3768",
        as_of: "2026-07-27T14:00:00.000Z",
        company_name: "Apple Inc.",
        delta: "-0.24",
        dte: 26,
        errors: [],
        exchange: "NASDAQ",
        expiration: "2026-08-22",
        implied_volatility: "0.30",
        liquidity_quality: "excellent",
        long_strike: null,
        ma20: "195",
        ma50: "190",
        ma200: "180",
        option_type: "put",
        premium_received: "255",
        premium_yield: "0.0268",
        rank: 1,
        return_on_risk: null,
        rsi14: "55",
        score: 97,
        short_strike: "95",
        snapshot_id: "snapshot-1",
        strategy: "short_put",
        symbol: "AAPL",
        trend: "bullish",
        underlying_as_of: "2026-07-27T14:00:00.000Z",
        underlying_price: "100",
        warning_count: 0,
        warnings: [],
      }]);
    const { getSharedMarketBatchScreenerResponse } = await import("./reader");
    const response = await getSharedMarketBatchScreenerResponse(
      {
        batchSize: 8,
        limit: 1,
        persona: "balanced_wheel",
        strategy: "short_put",
      },
      Date.parse("2026-07-27T14:10:00.000Z"),
    );

    expect(response).toMatchObject({
      companies: [{
        bestCandidate: {
          annualizedYield: 0.3768,
          premiumReceived: 255,
          premiumYield: 0.0268,
          shortStrike: 95,
        },
        rank: 1,
        score: 97,
        ticker: "AAPL",
      }],
      dataFreshness: {
        ageMinutes: 5,
        cacheStatus: "fresh",
        source: "materialized",
      },
      progress: {
        nextCursor: 1,
        processedCount: 250,
        totalCount: 250,
      },
      screenedCount: 250,
      skippedCount: 40,
    });
    expect(restMock.mock.calls.map(([table]) => table)).toEqual([
      "wheel_market_batch_current_snapshots",
      "wheel_market_batch_snapshots",
      "wheel_market_batch_candidates",
    ]);
  });

  it("does not read shared snapshots for forced refreshes", async () => {
    const { getSharedMarketBatchScreenerResponse } = await import("./reader");

    await expect(
      getSharedMarketBatchScreenerResponse({
        forceRefresh: true,
        persona: "balanced_wheel",
        strategy: "short_put",
      }),
    ).resolves.toBeNull();
    expect(restMock).not.toHaveBeenCalled();
  });
});
