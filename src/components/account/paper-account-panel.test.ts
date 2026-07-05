import { describe, expect, it } from "vitest";
import { PAPER_STARTING_CASH_STEP } from "./paper-account-panel";

function cents(value: number) {
  return Math.round(value * 100);
}

describe("PAPER_STARTING_CASH_STEP", () => {
  it("allows large whole-dollar balances that are not 100-dollar increments", () => {
    const value = 129_888;
    const step = Number(PAPER_STARTING_CASH_STEP);

    expect(cents(value) % cents(step)).toBe(0);
  });
});
