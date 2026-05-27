import { describe, expect, it } from "vitest";
import { analyzeRequestSchema, savedPresetInputSchema } from "./validation";

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
});
