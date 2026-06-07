import { describe, expect, it } from "vitest";
import {
  analyzeRequestSchema,
  savedPresetInputSchema,
  screenerRequestSchema,
} from "./validation";

describe("wheel validation", () => {
  it("normalizes analysis request defaults", () => {
    const parsed = analyzeRequestSchema.parse({
      ticker: " aapl ",
    });

    expect(parsed).toMatchObject({
      ticker: "aapl",
      persona: "balanced_wheel",
      resultLimit: 25,
      forceRefresh: false,
    });
  });

  it("rejects invalid tickers and filter ranges", () => {
    expect(() =>
      analyzeRequestSchema.parse({
        ticker: "AAPL!",
      }),
    ).toThrow();
    expect(() =>
      analyzeRequestSchema.parse({
        ticker: "AAPL",
        filters: {
          deltaMin: 1.2,
        },
      }),
    ).toThrow();
  });

  it("defaults empty preset filters", () => {
    const parsed = savedPresetInputSchema.parse({
      name: "Balanced income",
      basePersona: "balanced_wheel",
    });

    expect(parsed.filters).toEqual({});
  });

  it("normalizes screener request defaults", () => {
    const parsed = screenerRequestSchema.parse({});

    expect(parsed).toMatchObject({
      persona: "balanced_wheel",
      strategy: "short_put",
      limit: 50,
      forceRefresh: false,
      cursor: 0,
      batchSize: 32,
    });
  });
});
