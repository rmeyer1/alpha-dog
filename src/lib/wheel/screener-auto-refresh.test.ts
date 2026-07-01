import { describe, expect, it } from "vitest";
import type { WheelScreenerResponse } from "./types";
import { shouldAutoRefreshScreenerResponse } from "./screener-auto-refresh";

function response(
  overrides: Partial<WheelScreenerResponse["dataFreshness"]> = {},
): WheelScreenerResponse {
  return {
    companies: [],
    dataFreshness: {
      ageMinutes: 30,
      asOf: "2026-07-01T03:19:25.547Z",
      cacheStatus: "stale",
      feed: "opra",
      lastCompletedAt: "2026-07-01T03:19:25.547Z",
      lastStartedAt: "2026-07-01T03:19:08.634Z",
      nextSuggestedRefreshAt: "2026-07-01T03:34:25.547Z",
      refreshStatus: "stale",
      source: "materialized",
      ...overrides,
    },
    errors: [],
    persona: {
      id: "balanced_wheel",
      motto: "Income with discipline.",
      name: "Balanced Wheel",
    },
    progress: {
      batchScreenedCount: 0,
      batchSize: 8,
      cursor: 0,
      nextCursor: null,
      processedCount: 0,
      resultScope: "complete",
      status: "complete",
      totalCount: 0,
    },
    screenedCount: 0,
    skippedCount: 0,
    warnings: [],
  };
}

describe("shouldAutoRefreshScreenerResponse", () => {
  it("auto-refreshes stale materialized screener responses once", () => {
    expect(
      shouldAutoRefreshScreenerResponse({
        alreadyRefreshed: false,
        response: response(),
      }),
    ).toBe(true);
  });

  it("does not auto-refresh fresh materialized responses", () => {
    expect(
      shouldAutoRefreshScreenerResponse({
        alreadyRefreshed: false,
        response: response({
          ageMinutes: 5,
          cacheStatus: "fresh",
          refreshStatus: "fresh",
        }),
      }),
    ).toBe(false);
  });

  it("does not auto-refresh while a materialized refresh is already running", () => {
    expect(
      shouldAutoRefreshScreenerResponse({
        alreadyRefreshed: false,
        response: response({ refreshStatus: "refreshing" }),
      }),
    ).toBe(false);
  });

  it("does not auto-refresh non-materialized or already refreshed responses", () => {
    expect(
      shouldAutoRefreshScreenerResponse({
        alreadyRefreshed: false,
        response: response({ source: "live" }),
      }),
    ).toBe(false);

    expect(
      shouldAutoRefreshScreenerResponse({
        alreadyRefreshed: true,
        response: response(),
      }),
    ).toBe(false);
  });
});
