import { describe, expect, it } from "vitest";
import {
  leaderboardQuerySchema,
  momentumQuerySchema,
  sharpPlaysQuerySchema,
  walletAddressSchema,
  whaleQuerySchema,
} from "./validation";

describe("polymarket validation", () => {
  it("normalizes leaderboard defaults", () => {
    const parsed = leaderboardQuerySchema.parse({});

    expect(parsed).toMatchObject({
      category: "OVERALL",
      forceRefresh: false,
      limit: 25,
      offset: 0,
      orderBy: "PNL",
      timePeriod: "WEEK",
    });
  });

  it("rejects invalid leaderboard ranges", () => {
    expect(() => leaderboardQuerySchema.parse({ limit: "51" })).toThrow();
    expect(() => leaderboardQuerySchema.parse({ offset: "-1" })).toThrow();
    expect(() => leaderboardQuerySchema.parse({ category: "BAD" })).toThrow();
  });

  it("normalizes wallet addresses", () => {
    const parsed = walletAddressSchema.parse(
      "0x56687BF447DB6Ffa42FfE2204a05Edaa20F55839",
    );

    expect(parsed).toBe("0x56687bf447db6ffa42ffe2204a05edaa20f55839");
    expect(() => walletAddressSchema.parse("0x123")).toThrow();
  });

  it("defaults whale criteria", () => {
    const parsed = whaleQuerySchema.parse({});

    expect(parsed.minValue).toBe(10000);
  });

  it("defaults sharp play criteria", () => {
    const parsed = sharpPlaysQuerySchema.parse({});

    expect(parsed.minTraders).toBe(3);
    expect(() => sharpPlaysQuerySchema.parse({ minTraders: "1" })).toThrow();
  });

  it("defaults momentum scan criteria", () => {
    const parsed = momentumQuerySchema.parse({});

    expect(parsed).toMatchObject({
      category: "OVERALL",
      limit: 25,
      minSampleSize: 8,
      minWinRate: 0.75,
      sampleSize: 20,
      scanDepth: 300,
      timePeriod: "WEEK",
    });
    expect(() => momentumQuerySchema.parse({ scanDepth: "25" })).toThrow();
    expect(() => momentumQuerySchema.parse({ minWinRate: "0.25" })).toThrow();
  });
});
