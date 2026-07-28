import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scoreMarketBatchConsumer } from "./market-batch/domain";
import type {
  MarketBatchOptionRow,
  MarketBatchUnderlyingRow,
} from "./market-batch/model";
import { scoreLegacyScannerFromMarketBatch } from "./scanner-parity";
import type {
  WheelCompanyStrategy,
  WheelScreenerRequest,
} from "./types";

const MAX_REPRESENTATIVE_PARITY_MS = 6_000;
const REPRESENTATIVE_CONSUMER_COUNT = 20;
const REPRESENTATIVE_UNDERLYING_COUNT = 250;
const fixture = JSON.parse(
  readFileSync(
    "src/lib/wheel/fixtures/scanner-parity-v2.json",
    "utf8",
  ),
) as {
  capturedAt: string;
  options: MarketBatchOptionRow[];
  underlyings: MarketBatchUnderlyingRow[];
};
const strategies: WheelCompanyStrategy[] = [
  "short_put",
  "covered_call",
  "put_credit_spread",
  "call_credit_spread",
];
const personas = [
  "conservative_wheel",
  "balanced_wheel",
  "aggressive_yield",
  "weekly_theta",
  "high_iv_hunter",
] as const;

function representativeFacts() {
  const underlyingTemplate = fixture.underlyings[0]!;
  const optionTemplates = fixture.options.filter((row) =>
    row.underlying_symbol === "FIXT"
  );
  const underlyings: MarketBatchUnderlyingRow[] = [];
  const options: MarketBatchOptionRow[] = [];

  for (let index = 0; index < REPRESENTATIVE_UNDERLYING_COUNT; index += 1) {
    const symbol = `B${index.toString().padStart(3, "0")}`;

    underlyings.push({
      ...underlyingTemplate,
      company_name: `Benchmark ${index}`,
      earnings_context: {
        ...underlyingTemplate.earnings_context,
        symbol,
      },
      symbol,
      universe_rank: index + 1,
    });
    options.push(
      ...optionTemplates.map((row, optionIndex) => ({
        ...row,
        contract_symbol:
          `${symbol}-${optionIndex}-${row.contract_symbol.slice(4)}`,
        underlying_symbol: symbol,
      })),
    );
  }

  return { options, underlyings };
}

describe("scanner parity representative workload benchmark", () => {
  it(`scores ${REPRESENTATIVE_CONSUMER_COUNT} consumers over ${REPRESENTATIVE_UNDERLYING_COUNT} persisted underlyings within ${MAX_REPRESENTATIVE_PARITY_MS}ms`, () => {
    const facts = representativeFacts();
    const requests: WheelScreenerRequest[] = personas.flatMap((persona) =>
      strategies.map((strategy) => ({ persona, strategy }))
    );
    const now = new Date(fixture.capturedAt);
    let candidateCount = 0;
    const startedAt = performance.now();

    for (const request of requests) {
      const replacement = scoreMarketBatchConsumer({
        feed: "opra",
        now,
        optionRows: facts.options,
        request,
        underlyingRows: facts.underlyings,
      });
      const legacy = scoreLegacyScannerFromMarketBatch({
        now,
        optionRows: facts.options,
        request,
        underlyingRows: facts.underlyings,
      });

      candidateCount += replacement.companies.length + legacy.length;
    }

    const durationMs = performance.now() - startedAt;

    expect(requests).toHaveLength(REPRESENTATIVE_CONSUMER_COUNT);
    expect(candidateCount).toBeGreaterThan(0);
    expect(durationMs).toBeLessThan(MAX_REPRESENTATIVE_PARITY_MS);
  });
});
