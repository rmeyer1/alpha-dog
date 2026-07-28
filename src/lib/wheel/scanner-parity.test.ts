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
  WheelFilters,
  WheelScreenerRequest,
} from "./types";

const fixtureText = readFileSync(
  "src/lib/wheel/fixtures/scanner-parity-v2.json",
  "utf8",
);
const fixture = JSON.parse(fixtureText) as {
  boundaryCases: Array<{
    at: Partial<WheelFilters>;
    beyond: Partial<WheelFilters>;
    expectation:
      | "candidate_count_changes"
      | "golden_same"
      | "score_changes";
    factVariant?:
      | "blocked_nearest_long_leg"
      | "known_earnings"
      | "weekly_only";
    name: keyof WheelFilters;
    strategy: WheelCompanyStrategy;
  }>;
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

function scoreBoth(
  request: WheelScreenerRequest,
  options = fixture.options,
  {
    factErrors = [],
    feed = "opra",
    now = new Date(fixture.capturedAt),
    underlyings = fixture.underlyings,
  }: {
    factErrors?: string[];
    feed?: "indicative" | "opra";
    now?: Date;
    underlyings?: MarketBatchUnderlyingRow[];
  } = {},
) {
  const replacement = scoreMarketBatchConsumer({
    factErrors,
    feed,
    now,
    optionRows: options,
    request,
    underlyingRows: underlyings,
  });
  const legacy = scoreLegacyScannerFromMarketBatch({
    now,
    optionRows: options,
    request,
    underlyingRows: underlyings,
  });
  const legacySurface = legacyScannerParitySurface({
    factErrors,
    feed,
    legacyCompanies: legacy,
    underlyingRows: underlyings,
  });
  const parity = compareScannerCandidates(legacy, replacement.companies, {
    legacy: legacySurface,
    replacement: {
      errors: replacement.response.errors,
      skippedCount: replacement.response.skippedCount,
      warnings: replacement.response.warnings,
    },
  });

  return { legacy, legacySurface, parity, replacement };
}

function score(
  request: WheelScreenerRequest,
  options = fixture.options,
  settings?: Parameters<typeof scoreBoth>[2],
) {
  return scoreBoth(request, options, settings).parity;
}

function factsForBoundary(
  variant: (typeof fixture.boundaryCases)[number]["factVariant"],
) {
  if (variant === "weekly_only") {
    return {
      options: fixture.options.filter((row) =>
        row.expiration === "2026-08-07"
      ),
      underlyings: fixture.underlyings.filter((row) => row.symbol === "FIXT"),
    };
  }

  if (variant === "known_earnings") {
    return {
      options: fixture.options,
      underlyings: fixture.underlyings.map((row) => ({
        ...row,
        earnings_as_of: fixture.capturedAt,
        earnings_context: {
          asOf: fixture.capturedAt,
          coverageThrough: "2026-08-31",
          events: [{
            date: "2026-08-10",
            epsActual: null,
            epsEstimate: null,
            hour: "amc",
            quarter: 2,
            revenueActual: null,
            revenueEstimate: null,
            source: "finnhub" as const,
            symbol: row.symbol,
            year: 2026,
          }],
          providerEnabled: true,
          symbol: row.symbol,
        },
      })),
    };
  }

  if (variant === "blocked_nearest_long_leg") {
    const options = fixture.options.filter((row) =>
      row.underlying_symbol === "FIXT" &&
      row.option_type === "put" &&
      row.expiration === "2026-08-21"
    );
    const primary = options[0]!;

    return {
      options: [
        ...options,
        {
          ...primary,
          ask: 2.7,
          bid: 2.6,
          contract_symbol: "FIXT260821P00094000",
          delta: -0.1,
          strike: 94,
        },
      ],
      underlyings: fixture.underlyings.filter((row) => row.symbol === "FIXT"),
    };
  }

  return {
    options: fixture.options,
    underlyings: fixture.underlyings,
  };
}

describe("versioned scanner parity fixture", () => {
  it("declares every persona, strategy, executable boundary, and degraded input", () => {
    expect(fixture.formatVersion).toBe(2);
    expect(fixture.coverage.personas).toEqual(personas.map(({ id }) => id));
    expect(fixture.coverage.strategies).toEqual(strategies);
    expect(fixture.boundaryCases.map(({ name }) => name)).toEqual(
      fixture.coverage.filterBoundaries,
    );
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

  it.each(fixture.boundaryCases)(
    "executes the $name boundary against both projections",
    ({ at, beyond, expectation, factVariant, strategy }) => {
      const facts = factsForBoundary(factVariant);
      const atBoundary = scoreBoth(
        {
          filters: at,
          persona: "balanced_wheel",
          strategy,
        },
        facts.options,
        { underlyings: facts.underlyings },
      );
      const beyondBoundary = scoreBoth(
        {
          filters: beyond,
          persona: "balanced_wheel",
          strategy,
        },
        facts.options,
        { underlyings: facts.underlyings },
      );

      expect(atBoundary.parity.exactMatch).toBe(true);
      expect(beyondBoundary.parity.exactMatch).toBe(true);
      expect(atBoundary.legacy).toEqual(atBoundary.replacement.companies);
      expect(beyondBoundary.legacy).toEqual(
        beyondBoundary.replacement.companies,
      );

      if (expectation === "candidate_count_changes") {
        expect(atBoundary.legacy.length).toBeGreaterThan(0);
        expect(beyondBoundary.legacy.length).toBeLessThan(
          atBoundary.legacy.length,
        );
      } else if (expectation === "score_changes") {
        expect(atBoundary.legacy.map(({ ticker }) => ticker)).toEqual(
          beyondBoundary.legacy.map(({ ticker }) => ticker),
        );
        expect(atBoundary.legacy.map(({ score }) => score)).not.toEqual(
          beyondBoundary.legacy.map(({ score }) => score),
        );
      } else {
        expect(atBoundary.legacy.length).toBeGreaterThan(0);
        expect(beyondBoundary.legacy).toEqual(atBoundary.legacy);
      }
    },
  );

  it("executes partial option metadata and empty provider results", () => {
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
    const partialResult = scoreBoth({
      persona: "balanced_wheel",
      strategy: "short_put",
    }, partial);
    const emptyResult = scoreBoth({
      persona: "balanced_wheel",
      strategy: "short_put",
    }, []);

    expect(partialResult.parity.exactMatch).toBe(true);
    expect(partialResult.legacy.length).toBeGreaterThan(0);
    expect(partialResult.legacy[0]?.bestCandidate.liquidityQuality)
      .toBeDefined();
    expect(emptyResult.parity.exactMatch).toBe(true);
    expect(emptyResult.legacy).toEqual([]);
    expect(emptyResult.replacement.companies).toEqual([]);
  });

  it("executes provider timeout and indicative-feed surfaces without exposing values", () => {
    const result = scoreBoth(
      { persona: "balanced_wheel", strategy: "short_put" },
      fixture.options,
      {
        factErrors: ["fixture provider timeout"],
        feed: "indicative",
      },
    );

    expect(result.parity.exactMatch).toBe(true);
    expect(result.legacySurface.errors).toEqual(["fixture provider timeout"]);
    expect(result.replacement.response.errors).toEqual([
      "fixture provider timeout",
    ]);
    expect(result.legacySurface.warnings).toHaveLength(2);
    expect(JSON.stringify(result.parity.samples))
      .not.toContain("provider timeout");
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

  it("executes stale facts while preserving their captured timestamp", () => {
    const staleAsOf = "2026-07-24T14:00:00.000Z";
    const underlyings = fixture.underlyings.map((row) => ({
      ...row,
      captured_at: staleAsOf,
      latest_trade_at: staleAsOf,
      technical_as_of: staleAsOf,
    }));
    const result = scoreBoth(
      { persona: "balanced_wheel", strategy: "short_put" },
      fixture.options,
      { underlyings },
    );

    expect(result.parity.exactMatch).toBe(true);
    expect(result.legacy.length).toBeGreaterThan(0);
    expect(result.replacement.response.dataFreshness.asOf).toBe(staleAsOf);
  });

  it("executes a genuine multi-company score tie deterministically", () => {
    const tiedOptions = fixture.options.filter((row) =>
      row.expiration === "2026-08-21"
    );
    const request = {
      persona: "balanced_wheel" as const,
      strategy: "short_put" as const,
    };
    const result = scoreBoth(request, tiedOptions);

    expect(result.parity.exactMatch).toBe(true);
    expect(result.legacy.map(({ ticker }) => ticker)).toEqual([
      "FIXT",
      "TIEB",
    ]);
    expect(new Set(result.legacy.map(({ score }) => score)).size).toBe(1);
    expect(
      scoreBoth(request, [...tiedOptions].reverse()).legacy,
    ).toEqual(result.legacy);
  });

  it("rejects missing quote fields in both projections before publication", () => {
    const malformed = [{
      ...fixture.options[0],
      bid: null,
    }, ...fixture.options.slice(1)] as MarketBatchOptionRow[];
    const request = {
      persona: "balanced_wheel" as const,
      strategy: "short_put" as const,
    };

    expect(() =>
      scoreMarketBatchConsumer({
        feed: "opra",
        now: new Date(fixture.capturedAt),
        optionRows: malformed,
        request,
        underlyingRows: fixture.underlyings,
      })
    ).toThrow("invalid quote fields");
    expect(() =>
      scoreLegacyScannerFromMarketBatch({
        now: new Date(fixture.capturedAt),
        optionRows: malformed,
        request,
        underlyingRows: fixture.underlyings,
      })
    ).toThrow("invalid quote fields");
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
