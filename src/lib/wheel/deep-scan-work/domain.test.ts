import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import type { MarketBatchOptionStageSummary } from "../market-batch/model";
import type { WheelScreenerRequest } from "../types";
import {
  deepScanCoverageIntervalStartedAt,
  deepScanCoverageWindowState,
  requestsForDeepScanClaims,
  resultsForDeepScanClaims,
  simulateTieredCoverageWeek,
} from "./domain";
import { optionUnitsForDeepScanClaims } from "./work-units";
import type { DeepScanWorkClaim } from "./model";

const putRequest: WheelScreenerRequest = {
  persona: "balanced_wheel",
  strategy: "short_put",
};
const spreadRequest: WheelScreenerRequest = {
  persona: "balanced_wheel",
  strategy: "put_credit_spread",
};
const callRequest: WheelScreenerRequest = {
  persona: "balanced_wheel",
  strategy: "covered_call",
};

function claim(
  symbol: string,
  optionType: "put" | "call",
): DeepScanWorkClaim {
  return {
    attemptCount: 1,
    coverageTier: "priority",
    leaseAcquiredAt: "2026-11-23T13:00:00.000Z",
    leaseExpiresAt: "2026-11-23T14:00:00.000Z",
    leaseOwnerId: "00000000-0000-4000-8000-000000000001",
    leaseToken: `${symbol}-${optionType}`,
    nextDueAt: "2026-11-23T13:00:00.000Z",
    optionType,
    symbol,
    tierPriority: 1,
    tierRank: 1,
  };
}

describe("tiered deep scan work domain", () => {
  it("rounds interval identities and rejects invalid intervals", () => {
    expect(
      deepScanCoverageIntervalStartedAt(
        new Date("2026-07-27T14:14:59.999Z"),
      ),
    ).toBe("2026-07-27T14:00:00.000Z");
    expect(() => deepScanCoverageIntervalStartedAt(new Date(), 0)).toThrow(
      "positive",
    );
  });

  it("honors holidays, early closes, and the premarket coverage window", () => {
    expect(
      deepScanCoverageWindowState(
        new Date("2026-11-26T15:00:00.000Z"),
      ).isOpen,
    ).toBe(false);
    expect(
      deepScanCoverageWindowState(
        new Date("2026-11-27T12:59:00.000Z"),
      ).isOpen,
    ).toBe(false);
    expect(
      deepScanCoverageWindowState(
        new Date("2026-11-27T13:00:00.000Z"),
      ).isOpen,
    ).toBe(true);
    expect(
      deepScanCoverageWindowState(
        new Date("2026-11-27T17:59:00.000Z"),
      ).isOpen,
    ).toBe(true);
    expect(
      deepScanCoverageWindowState(
        new Date("2026-11-27T18:00:00.000Z"),
      ).isOpen,
    ).toBe(false);
  });

  it("selects only consumers for claimed option types and deduplicates them", () => {
    expect(
      requestsForDeepScanClaims(
        [putRequest, { ...putRequest }, spreadRequest, callRequest],
        [claim("AAPL", "put")],
      ),
    ).toEqual([putRequest, spreadRequest]);
  });

  it("builds a 625-unit mixed fan-out without cross-product work at low overhead", () => {
    const symbols = Array.from(
      { length: 313 },
      (_, index) => `SYM${index.toString().padStart(3, "0")}`,
    );
    const claims = symbols.flatMap((symbol) => [
      claim(symbol, "put"),
      claim(symbol, "call"),
    ]).slice(0, 625);
    const samples: number[] = [];

    for (let batch = 0; batch < 80; batch += 1) {
      const startedAt = performance.now();
      for (let iteration = 0; iteration < 100; iteration += 1) {
        optionUnitsForDeepScanClaims(symbols, ["put", "call"], claims);
      }
      samples.push((performance.now() - startedAt) / 100);
    }

    const units = optionUnitsForDeepScanClaims(
      symbols,
      ["put", "call"],
      claims,
    );
    const sorted = [...samples].sort((left, right) => left - right);
    const p95Ms = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;

    console.info("tiered_deep_scan_mixed_fanout_benchmark", {
      claims: claims.length,
      p95Ms,
      samples: samples.length,
      units: units.length,
    });

    expect(units).toHaveLength(625);
    expect(
      new Set(units.map((unit) => `${unit.symbol}:${unit.optionType}`)),
    ).toHaveLength(625);
    expect(p95Ms).toBeLessThan(10);
  });

  it("classifies completed, empty, unavailable, and failed provider facts", () => {
    const claims = [
      claim("AAPL", "put"),
      claim("MSFT", "put"),
      claim("NVDA", "call"),
      claim("MISSING", "call"),
    ];
    const stages: MarketBatchOptionStageSummary[] = [
      {
        contractCount: 4,
        durationMs: 1,
        error: null,
        optionType: "put",
        providerRequests: 1,
        symbol: "AAPL",
      },
      {
        contractCount: 0,
        durationMs: 1,
        error: null,
        optionType: "put",
        providerRequests: 1,
        symbol: "MSFT",
      },
      {
        contractCount: 0,
        durationMs: 1,
        error: "provider unavailable",
        optionType: "call",
        providerRequests: 1,
        symbol: "NVDA",
      },
    ];

    expect(
      resultsForDeepScanClaims(claims, stages).map((result) => result.outcome),
    ).toEqual(["complete", "no_candidate", "provider_outage", "failed"]);
  });

  it("covers all default tiers through a holiday and early-close week", () => {
    const instants: Date[] = [];
    for (
      let time = Date.parse("2026-11-23T12:00:00.000Z");
      time <= Date.parse("2026-11-27T22:00:00.000Z");
      time += 15 * 60 * 1000
    ) {
      instants.push(new Date(time));
    }
    const startedAt = Date.parse("2026-11-23T13:00:00.000Z");
    const units = [
      ...Array.from({ length: 500 }, (_, index) => ({
        freshnessMs: 15 * 60 * 1000,
        id: `priority-${index}`,
        nextDueMs: startedAt,
        tierPriority: 1,
      })),
      ...Array.from({ length: 1500 }, (_, index) => ({
        freshnessMs: 24 * 60 * 60 * 1000,
        id: `daily-${index}`,
        nextDueMs: startedAt,
        tierPriority: 2,
      })),
      ...Array.from({ length: 6906 }, (_, index) => ({
        freshnessMs: 7 * 24 * 60 * 60 * 1000,
        id: `weekly-${index}`,
        nextDueMs: startedAt,
        tierPriority: 3,
      })),
    ];

    const result = simulateTieredCoverageWeek({
      capacity: 625,
      instants,
      units,
    });

    expect(result.closedDispatchCount).toBeGreaterThan(0);
    expect(result.units.every((unit) => unit.completedCount > 0)).toBe(true);
    // The queue remains truthfully overdue while the market is closed; the
    // 40-hour maximum is the Thanksgiving close-to-Friday-window gap.
    expect(
      Math.max(
        ...result.units
          .filter((unit) => unit.id.startsWith("priority-"))
          .map((unit) => unit.maximumLatenessMs),
      ),
    ).toBe(40 * 60 * 60 * 1000);
  });
});
