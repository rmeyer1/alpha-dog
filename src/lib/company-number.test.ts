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

  it("rounds positive and negative half cents using decimal semantics", () => {
    expect(formatCompanyCurrency(1.005)).toBe("$1.01");
    expect(formatCompanyCurrency(2.675)).toBe("$2.68");
    expect(formatCompanyCurrency(10.075)).toBe("$10.08");
    expect(formatCompanyCurrency(-1.005)).toBe("-$1.01");
    expect(formatCompanyCurrency(-2.675)).toBe("-$2.68");
    expect(formatCompanyCurrency(-10.075)).toBe("-$10.08");
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

  it("promotes compact suffixes when one-decimal rounding carries", () => {
    expect(formatCompanyMarketCapFromMillions(999.949)).toBe("$999.9M");
    expect(formatCompanyMarketCapFromMillions(999.95)).toBe("$1B");
    expect(formatCompanyMarketCapFromMillions(-999.949)).toBe("-$999.9M");
    expect(formatCompanyMarketCapFromMillions(-999.95)).toBe("-$1B");
    expect(formatCompanyMarketCapFromMillions(999_949)).toBe("$999.9B");
    expect(formatCompanyMarketCapFromMillions(999_950)).toBe("$1T");
    expect(formatCompanyMarketCapFromMillions(-999_949)).toBe("-$999.9B");
    expect(formatCompanyMarketCapFromMillions(-999_950)).toBe("-$1T");
  });

  it("fails closed for absent and non-finite values", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatCompanyCurrency(value)).toBe("-");
      expect(formatCompanyInteger(value)).toBe("-");
      expect(formatCompanyMarketCapFromMillions(value)).toBe("-");
    }
  });
});
