import { describe, expect, it } from "vitest";
import {
  companyProfileIsNotFound,
  normalizeCompanyTicker,
  type CompanyProfile,
} from "./company-profile";

function profile(
  marketStatus: CompanyProfile["market"]["status"],
  signalScribeStatus: CompanyProfile["signalScribe"]["status"],
): CompanyProfile {
  return {
    ticker: "AAPL",
    market: {
      asOf: null,
      asset: null,
      bars: [],
      snapshot: null,
      stats: null,
      status: marketStatus,
    },
    signalScribe: {
      analyses: [],
      company: null,
      filings: [],
      financialFacts: [],
      sections: [],
      status: signalScribeStatus,
    },
  };
}

describe("normalizeCompanyTicker", () => {
  it("normalizes supported equity symbols without silently rewriting invalid input", () => {
    expect(normalizeCompanyTicker("aapl")).toBe("AAPL");
    expect(normalizeCompanyTicker("brk.b")).toBe("BRK.B");
    expect(normalizeCompanyTicker("BF-B")).toBe("BF-B");
    expect(normalizeCompanyTicker(" AAPL")).toBeNull();
    expect(normalizeCompanyTicker("AAPL/USD")).toBeNull();
    expect(normalizeCompanyTicker("AAPL..B")).toBeNull();
    expect(normalizeCompanyTicker("")).toBeNull();
  });
});

describe("companyProfileIsNotFound", () => {
  it("uses a confirmed provider miss as the not-found boundary", () => {
    expect(companyProfileIsNotFound(profile("not_found", "not_found"))).toBe(true);
    expect(companyProfileIsNotFound(profile("not_found", "available"))).toBe(true);
    expect(companyProfileIsNotFound(profile("not_configured", "not_found")))
      .toBe(true);
  });

  it("does not turn provider outages or an unconfigured local setup into a 404", () => {
    expect(companyProfileIsNotFound(profile("error", "not_found"))).toBe(false);
    expect(
      companyProfileIsNotFound(profile("not_configured", "not_configured")),
    ).toBe(false);
  });
});
