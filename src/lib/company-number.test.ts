import { describe, expect, it } from "vitest";
import {
  formatCompanyCurrency,
  formatCompanyInteger,
  formatCompanyMarketCapFromMillions,
} from "./company-number";

describe("company number formatting", () => {
  it("formats currency without runtime locale data", () => {
    expect(formatCompanyCurrency(775_000)).toBe("$775,000.00");
    expect(formatCompanyCurrency(-0.25)).toBe("-$0.25");
    expect(formatCompanyCurrency(0)).toBe("$0.00");
  });

  it("formats rounded integers without runtime locale data", () => {
    expect(formatCompanyInteger(4_284_044.6)).toBe("4,284,045");
    expect(formatCompanyInteger(-1_234.5)).toBe("-1,235");
    expect(formatCompanyInteger(0)).toBe("0");
  });

  it("formats compact market caps deterministically across ICU runtimes", () => {
    expect(formatCompanyMarketCapFromMillions(962_000)).toBe("$962B");
    expect(formatCompanyMarketCapFromMillions(1_250)).toBe("$1.3B");
    expect(formatCompanyMarketCapFromMillions(12.5)).toBe("$12.5M");
    expect(formatCompanyMarketCapFromMillions(1_234_567)).toBe("$1.2T");
    expect(formatCompanyMarketCapFromMillions(-12.5)).toBe("-$12.5M");
  });

  it("fails closed for absent and non-finite values", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatCompanyCurrency(value)).toBe("-");
      expect(formatCompanyInteger(value)).toBe("-");
      expect(formatCompanyMarketCapFromMillions(value)).toBe("-");
    }
  });
});
