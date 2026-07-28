import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { personas } from "./personas";
import {
  compareScannerCandidates,
  legacyScannerParitySurface,
  SCANNER_PARITY_SAMPLE_LIMIT,
  scoreLegacyScannerFromMarketBatch,
} from "./scanner-parity";
import { scoreMarketBatchConsumer } from "./market-batch/domain";
import type {
  MarketBatchOptionRow,
  MarketBatchUnderlyingRow,
} from "./market-batch/model";
import type {
  WheelCompanyScore,
  WheelCompanyStrategy,
  WheelScreenerRequest,
} from "./types";

const fixtureText = readFileSync(
  "src/lib/wheel/fixtures/scanner-parity-v1.json",
  "utf8",
);
const fixture = JSON.parse(fixtureText) as {
  capturedAt: string;
  coverage: {
    degradedInputs: string[];
    filterBoundaries: string[];
    personas: string[];
    strategies: string[];
  };
  formatVersion: number;
  options: MarketBatchOptionRow[];
  underlyings: MarketBatchUnderlyingRow[];
};
const strategies: WheelCompanyStrategy[] = [
  "short_put",
  "covered_call",
  "put_credit_spread",
  "call_credit_spread",
];

function score(
  request: WheelScreenerRequest,
  options = fixture.options,
  {
    factErrors = [],
    feed = "opra",
  }: {
    factErrors?: string[];
    feed?: "indicative" | "opra";
  } = {},
) {
  const now = new Date(fixture.capturedAt);
  const replacement = scoreMarketBatchConsumer({
    factErrors,
    feed,
    now,
    optionRows: options,
    request,
    underlyingRows: fixture.underlyings,
  });
  const legacy = scoreLegacyScannerFromMarketBatch({
    now,
    optionRows: options,
    request,
    underlyingRows: fixture.underlyings,
  });

  return compareScannerCandidates(legacy, replacement.companies, {
    legacy: legacyScannerParitySurface({
      factErrors,
      feed,
      legacyCompanies: legacy,
      underlyingRows: fixture.underlyings,
    }),
    replacement: {
      errors: replacement.response.errors,
      skippedCount: replacement.response.skippedCount,
      warnings: replacement.response.warnings,
    },
  });
}

describe("versioned scanner parity fixture", () => {
  it("declares every persona, strategy, filter boundary, and degraded input", () => {
    expect(fixture.formatVersion).toBe(1);
    expect(fixture.coverage.personas).toEqual(personas.map(({ id }) => id));
    expect(fixture.coverage.strategies).toEqual(strategies);
    expect(fixture.coverage.filterBoundaries).toHaveLength(13);
    expect(fixture.coverage.degradedInputs).toEqual([
      "missing_quote",
      "stale_facts",
      "partial_option_metadata",
      "provider_timeout",
      "empty_results",
      "scoring_ties",
    ]);
  });

  it("contains no credential, prompt, payload, or user-financial fields", () => {
    expect(fixtureText).not.toMatch(
      /api[_-]?key|secret|authorization|prompt|raw[_-]?payload|account|portfolio|position/i,
    );
  });

  it.each(
    personas.flatMap(({ id: persona }) =>
      strategies.map((strategy) => ({ persona, strategy }))
    ),
  )(
    "matches legacy and replacement for $persona / $strategy",
    ({ persona, strategy }) => {
      const result = score({ persona, strategy });

      expect(result).toMatchObject({
        exactMatch: true,
        mismatchCount: 0,
      });
      expect(result.candidateCount.legacy).toBeGreaterThan(0);
    },
  );

  it("matches with partial option metadata and empty provider results", () => {
    const partial = fixture.options.map((row, index) =>
      index === 0
        ? {
            ...row,
            implied_volatility: null,
            open_interest: null,
            theta: null,
            volume: null,
          }
        : row
    );

    expect(score({
      persona: "balanced_wheel",
      strategy: "short_put",
    }, partial).exactMatch).toBe(true);
    expect(score({
      persona: "balanced_wheel",
      strategy: "short_put",
    }, []).exactMatch).toBe(true);
  });

  it("matches degraded provider errors and indicative-feed warnings without exposing values", () => {
    const result = score(
      { persona: "balanced_wheel", strategy: "short_put" },
      fixture.options,
      {
        factErrors: ["fixture provider timeout"],
        feed: "indicative",
      },
    );

    expect(result.exactMatch).toBe(true);
    expect(JSON.stringify(result.samples)).not.toContain("provider timeout");
  });

  it("is deterministic across persisted fact ordering", () => {
    const request = {
      persona: "balanced_wheel" as const,
      strategy: "put_credit_spread" as const,
    };

    expect(score(request, [...fixture.options].reverse())).toEqual(
      score(request, fixture.options),
    );
  });

  it("rejects malformed quote fields before either scorer can publish", () => {
    const malformed = [{
      ...fixture.options[0],
      bid: null,
    }, ...fixture.options.slice(1)] as MarketBatchOptionRow[];
    const request = {
      persona: "balanced_wheel" as const,
      strategy: "short_put" as const,
    };

    expect(() => score(request, malformed)).toThrow("invalid quote fields");
  });
});

describe("scanner parity diagnostics", () => {
  function company(index: number): WheelCompanyScore {
    return {
      bestCandidate: {
        delta: -0.2,
        dte: 25,
        expirationDate: "2026-08-21",
        impliedVolatility: 0.3,
        liquidityQuality: "good",
        premiumReceived: 100,
        score: 90,
        shortStrike: 95,
        strategy: "short_put",
        warningCount: 0,
      },
      errors: [],
      exchange: "NASDAQ",
      name: `Fixture ${index}`,
      rank: index + 1,
      score: 90,
      ticker: `T${index.toString().padStart(2, "0")}`,
      underlying: {
        asOf: "2026-07-27T14:00:00.000Z",
        movingAverages: { ma20: 98, ma50: 95, ma200: 90 },
        price: 100,
        rsi14: 50,
        symbol: `T${index.toString().padStart(2, "0")}`,
        trend: "neutral",
      },
      warnings: [],
    };
  }

  it("classifies financial, score, warning, eligibility, and ordering deltas", () => {
    const legacy = [company(0), company(1), company(2), company(3)];
    const replacement = [
      { ...company(0), bestCandidate: {
        ...company(0).bestCandidate,
        premiumReceived: 101,
      } },
      { ...company(1), score: 89 },
      { ...company(2), warnings: [{
        message: "fixture",
        severity: "warning" as const,
        type: "data_quality" as const,
      }], rank: 4 },
      { ...company(4), rank: 4 },
    ];
    replacement[0].rank = 2;

    const result = compareScannerCandidates(legacy, replacement);

    expect(result.exactMatch).toBe(false);
    expect(result.mismatches).toEqual({
      eligibility: 2,
      financial: 1,
      ordering: 1,
      score: 1,
      warning: 1,
    });
  });

  it("bounds diagnostic samples even when every candidate mismatches", () => {
    const result = compareScannerCandidates(
      Array.from({ length: 20 }, (_, index) => company(index)),
      [],
    );

    expect(result.samples).toHaveLength(SCANNER_PARITY_SAMPLE_LIMIT);
    expect(JSON.stringify(result.samples)).not.toMatch(
      /api[_-]?key|secret|prompt|account|portfolio/i,
    );
  });
});
