import { describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_CACHE_FRESH_TTL_MS,
  ANALYSIS_CACHE_STALE_TTL_MS,
  MemoryAnalysisCacheStore,
  buildAnalysisCacheKey,
} from "./analysis-cache";
import type { WheelAnalysisResponse, WheelFilters } from "./types";

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

const response: WheelAnalysisResponse = {
  ticker: "AAPL",
  underlying: {
    symbol: "AAPL",
    price: 100,
    asOf: "2026-05-27T16:00:00.000Z",
    trend: "bullish",
    rsi14: 55,
    movingAverages: {
      ma20: 98,
      ma50: 95,
      ma200: 90,
    },
  },
  persona: {
    id: "balanced_wheel",
    name: "Balanced Wheel",
    motto: "Income with discipline.",
  },
  dataFreshness: {
    feed: "indicative",
    cacheStatus: "fresh",
    asOf: "2026-05-27T16:00:00.000Z",
    nextSuggestedRefreshAt: "2026-05-27T16:02:00.000Z",
  },
  shortPuts: [],
  coveredCalls: [],
  putCreditSpreads: [],
  callCreditSpreads: [],
  warnings: [],
  errors: [],
};

describe("analysis cache", () => {
  it("builds stable keys for equivalent filters", () => {
    const left = buildAnalysisCacheKey({
      feed: "indicative",
      filters,
      personaId: "balanced_wheel",
      resultLimit: 25,
      ticker: " aapl ",
    });
    const right = buildAnalysisCacheKey({
      feed: "indicative",
      filters: {
        includeWeeklies: true,
        excludeEarnings: false,
        spreadLongLegCount: 3,
        maxSpreadWidth: 10,
        minSpreadReturnOnRisk: 0.2,
        maxSpreadPctOfMid: 0.2,
        minOpenInterest: 100,
        minVolume: 50,
        minPremiumYield: 0.01,
        deltaMax: 0.3,
        deltaMin: 0.15,
        dteMax: 30,
        dteMin: 21,
      },
      personaId: "balanced_wheel",
      resultLimit: 25,
      ticker: "AAPL",
    });

    expect(left).toBe(right);
  });

  it("separates keys by feed, persona, result limit, and filters", () => {
    const base = buildAnalysisCacheKey({
      feed: "indicative",
      filters,
      personaId: "balanced_wheel",
      resultLimit: 25,
      ticker: "AAPL",
    });

    expect(
      buildAnalysisCacheKey({
        feed: "opra",
        filters,
        personaId: "balanced_wheel",
        resultLimit: 25,
        ticker: "AAPL",
      }),
    ).not.toBe(base);
    expect(
      buildAnalysisCacheKey({
        feed: "indicative",
        filters,
        personaId: "conservative_wheel",
        resultLimit: 25,
        ticker: "AAPL",
      }),
    ).not.toBe(base);
    expect(
      buildAnalysisCacheKey({
        feed: "indicative",
        filters,
        personaId: "balanced_wheel",
        resultLimit: 10,
        ticker: "AAPL",
      }),
    ).not.toBe(base);
    expect(
      buildAnalysisCacheKey({
        feed: "indicative",
        filters: { ...filters, deltaMax: 0.35 },
        personaId: "balanced_wheel",
        resultLimit: 25,
        ticker: "AAPL",
      }),
    ).not.toBe(base);
  });

  it("returns fresh, then stale, then expired entries", () => {
    const store = new MemoryAnalysisCacheStore();
    const start = new Date("2026-05-27T16:00:00.000Z").getTime();

    store.set("key", response, start);

    expect(store.getFresh("key", start + ANALYSIS_CACHE_FRESH_TTL_MS - 1))
      .not.toBeNull();
    expect(store.getFresh("key", start + ANALYSIS_CACHE_FRESH_TTL_MS + 1))
      .toBeNull();
    expect(store.getStale("key", start + ANALYSIS_CACHE_FRESH_TTL_MS + 1))
      .not.toBeNull();
    expect(store.getStale("key", start + ANALYSIS_CACHE_STALE_TTL_MS + 1))
      .toBeNull();
  });

  it("clones cached responses to avoid external mutation", () => {
    const store = new MemoryAnalysisCacheStore();
    const start = Date.now();

    store.set("key", response, start);

    const first = store.getFresh("key", start);
    expect(first).not.toBeNull();
    first!.response.warnings.push({
      type: "data_quality",
      severity: "warning",
      message: "mutated",
    });

    expect(store.getFresh("key", start)?.response.warnings).toEqual([]);
  });

  it("works with fake timers for default clock callers", () => {
    const store = new MemoryAnalysisCacheStore();
    vi.useFakeTimers();
    vi.setSystemTime("2026-05-27T16:00:00.000Z");

    store.set("key", response);
    vi.setSystemTime("2026-05-27T16:01:00.000Z");

    expect(store.getFresh("key")).not.toBeNull();

    vi.useRealTimers();
  });
});
