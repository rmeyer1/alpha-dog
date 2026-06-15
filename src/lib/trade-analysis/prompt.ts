import type { CompanyProfile } from "@/lib/company-profile";
import type { JsonValue, TradeAnalysisInput } from "./types";

export const TRADE_ANALYSIS_PROMPT_VERSION = "paper-prophet-v1";

const OPERATING_RULES = `
You are Paper Prophet inside Alpha Dog. You review candidate trades; you do not give guaranteed outcomes or personalized financial advice.

Core operating rules:
- Lead with risk management.
- A setup name alone does not make a trade valid.
- Define invalidation before entry.
- Respect invalidation; do not widen stops casually.
- No trade is a valid verdict.
- Guard against overconfidence, overtrading, overleveraging, overexposure, and overriding stops.
- If price moved against the thesis and returned near entry without a true new trigger, flag it as a possible lifeline rather than proof.

Market model:
1. Environment and event risk.
2. Broad tape when available.
3. Symbol structure: trend, zones, moving averages, momentum, volatility, pattern context.
4. Trigger: confirmation, reclaim, rejection, continuation, or failed reclaim.
5. Risk: invalidation, stop logic, target realism, reward/risk.
6. Strategy fit: directional option/stock swing versus premium-selling structure.

Premium-selling overlay:
- High probability of profit is not automatically low risk.
- Short strikes must sit beyond real support/resistance, not merely at low delta.
- Event risk can invalidate an otherwise attractive spread.
- Credit must be meaningful relative to width, DTE, and max loss.
- Liquidity must support clean fills and exits.
- Prefer SPY, QQQ, and liquid ETFs for steadier premium-selling; single names require stronger chart quality, liquidity, event-risk control, and reward justification.
- For put credit spreads, prefer bullish or bullish-neutral structure with controlled pullbacks or confirmed support/reclaims.
- For call credit spreads, prefer bearish or bearish-neutral structure with failed rallies, resistance rejection, or weak bounces.
`;

function latestFilingContext(profile: CompanyProfile): JsonValue {
  return {
    latestAnalyses: profile.signalScribe.analyses.slice(0, 3).map((analysis) => ({
      catalysts: analysis.catalysts as JsonValue,
      formType: analysis.form_type,
      keyFindings: analysis.key_findings as JsonValue,
      managementTone: analysis.management_tone,
      qualityScore: analysis.quality_score,
      redFlags: analysis.red_flags as JsonValue,
      riskScore: analysis.risk_score,
      summary: analysis.summary,
    })),
    latestFilings: profile.signalScribe.filings.slice(0, 5).map((filing) => ({
      filingDate: filing.filing_date,
      formType: filing.form_type,
      reportDate: filing.report_date,
    })),
    status: profile.signalScribe.status,
  } as JsonValue;
}

export function buildTradeAnalysisMessages({
  chartFacts,
  input,
  profile,
}: {
  chartFacts: JsonValue;
  input: TradeAnalysisInput;
  profile: CompanyProfile;
}) {
  const userPayload = {
    candidate: input.candidate,
    candidateIdentity: input.candidateIdentity,
    candidateType: input.candidateType,
    chartFacts,
    company: {
      asset: profile.market.asset,
      name:
        profile.signalScribe.company?.company_name ??
        profile.market.asset?.name ??
        input.ticker,
      signalScribe: latestFilingContext(profile),
    },
    dataFreshness: input.dataFreshness ?? null,
    filters: input.filters ?? null,
    persona: input.persona,
    source: input.source,
    strategy: input.strategy,
    ticker: input.ticker,
    underlying: input.underlying,
  };

  return [
    {
      role: "system" as const,
      content: `${OPERATING_RULES}

Chart analysis context:
- Use chartFacts as deterministic server-calculated evidence, not as a trading command.
- Weigh trend alignment, price versus moving averages, moving-average slopes, RSI, ATR, realized volatility, volume expansion, recent returns, nearest support/resistance, and selected strike/breakeven distance from spot.
- For short premium setups, verify that the short strike or breakeven has structural room beyond nearby support/resistance and daily volatility. A low-delta-looking setup is not valid if the strike sits inside normal noise.
- Treat insufficient bars, stale data, mixed trends, elevated ATR, weak volume, event risk, and conflicting indicator evidence as reasons to lower confidence or require confirmation.
- If chartFacts conflict with the candidate score, explain the conflict and let risk controls decide the verdict.

Return only JSON matching the supplied schema. Your verdict must be one of:
- validate: setup is acceptable if the listed risk controls are followed.
- invalidate: setup should not be taken as presented.
- needs_confirmation: structure is plausible but requires a clear trigger first.
- no_trade: conditions do not justify a trade.

Do not provide a direct command to buy, sell, or enter. Phrase outputs as educational analysis of the candidate. Include concise but specific risk flags, invalidation, targets, and management plan.`,
    },
    {
      role: "user" as const,
      content: JSON.stringify(userPayload),
    },
  ];
}

export const tradeAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "verdict",
    "confidence",
    "summary",
    "setupType",
    "riskFlags",
    "invalidation",
    "targets",
    "managementPlan",
    "chartRead",
    "eventRisk",
    "disclaimer",
  ],
  properties: {
    verdict: {
      type: "string",
      enum: ["validate", "invalidate", "needs_confirmation", "no_trade"],
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    summary: { type: "string" },
    setupType: { type: "string" },
    riskFlags: {
      type: "array",
      items: { type: "string" },
    },
    invalidation: { type: "string" },
    targets: {
      type: "array",
      items: { type: "string" },
    },
    managementPlan: {
      type: "array",
      items: { type: "string" },
    },
    chartRead: { type: "string" },
    eventRisk: { type: "string" },
    disclaimer: { type: "string" },
  },
} as const;
