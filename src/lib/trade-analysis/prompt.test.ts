import { describe, expect, it } from "vitest";
import type { CompanyProfile } from "@/lib/company-profile";
import type { TradeAnalysisInput } from "./types";
import { buildTradeAnalysisMessages, tradeAnalysisJsonSchema } from "./prompt";

const input: TradeAnalysisInput = {
  candidate: {
    dte: 31,
    netCredit: 1.1,
    shortLeg: { strike: 180 },
  },
  candidateIdentity: {
    key: "spread-1",
    rank: 1,
    score: 88,
  },
  candidateType: "vertical_spread",
  persona: {
    id: "balanced_wheel",
    motto: "Income with discipline.",
    name: "Balanced Wheel",
  },
  source: "wheel_dashboard",
  strategy: "put_credit_spread",
  ticker: "AAPL",
  underlying: {
    asOf: "2026-06-15T14:30:00.000Z",
    movingAverages: {
      ma20: 190,
      ma50: 185,
      ma200: 170,
    },
    price: 195,
    rsi14: 55,
    symbol: "AAPL",
    trend: "bullish",
  },
};

const profile: CompanyProfile = {
  market: {
    asOf: "2026-06-15T14:30:00.000Z",
    asset: { name: "Apple Inc.", symbol: "AAPL" },
    bars: [],
    snapshot: null,
    stats: null,
    status: "available",
  },
  signalScribe: {
    analyses: [
      {
        accession_number: "1",
        business_summary: null,
        catalysts: ["new product"],
        created_at: "2026-06-15T14:30:00.000Z",
        financial_summary: [],
        form_type: "10-Q",
        id: "analysis-1",
        key_findings: ["margin stability"],
        management_tone: "balanced",
        quality_score: 72,
        red_flags: ["valuation"],
        risk_score: 41,
        source_citations: [],
        summary: "Latest filing summary.",
      },
    ],
    company: {
      cik: "0000320193",
      company_name: "Apple Inc.",
      exchange: "NASDAQ",
      id: "company-1",
      industry: "Consumer Electronics",
      sector: "Technology",
      sic: "3571",
      ticker: "AAPL",
    },
    filings: [],
    financialFacts: [],
    sections: [],
    status: "available",
  },
  ticker: "AAPL",
};

describe("trade analysis prompt", () => {
  it("includes the risk-first premium selling instructions and candidate payload", () => {
    const messages = buildTradeAnalysisMessages({
      chartFacts: { trend: "bullish" },
      input,
      profile,
    });

    expect(messages[0].content).toContain("Lead with risk management");
    expect(messages[0].content).toContain("Short strikes must sit beyond real support/resistance");
    expect(messages[0].content).toContain("No trade is a valid verdict");
    expect(messages[0].content).toContain("server-calculated evidence");
    expect(messages[0].content).toContain("nearest support/resistance");
    expect(messages[1].content).toContain("\"strategy\":\"put_credit_spread\"");
    expect(messages[1].content).toContain("\"chartFacts\"");
    expect(messages[1].content).toContain("\"ticker\":\"AAPL\"");
  });

  it("requires the structured verdict fields", () => {
    expect(tradeAnalysisJsonSchema.required).toContain("verdict");
    expect(tradeAnalysisJsonSchema.required).toContain("invalidation");
    expect(tradeAnalysisJsonSchema.required).toContain("managementPlan");
  });
});
