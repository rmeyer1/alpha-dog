export type PersonaId =
  | "conservative_wheel"
  | "balanced_wheel"
  | "aggressive_yield"
  | "weekly_theta"
  | "high_iv_hunter";

export type OptionType = "put" | "call";
export type Trend = "bullish" | "neutral" | "bearish";
export type CacheStatus = "fresh" | "stale" | "demo";
export type DataFeed = "opra" | "indicative" | "demo";
export type QualityLabel =
  | "excellent"
  | "good"
  | "acceptable"
  | "weak"
  | "poor"
  | "unknown";

export interface WheelFilters {
  dteMin: number;
  dteMax: number;
  deltaMin: number;
  deltaMax: number;
  minPremiumYield: number;
  minVolume: number;
  minOpenInterest: number;
  maxSpreadPctOfMid: number;
  minSpreadReturnOnRisk: number;
  maxSpreadWidth: number;
  spreadLongLegCount: number;
  excludeEarnings: boolean;
  includeWeeklies: boolean;
}

export interface PersonaConfig {
  id: PersonaId;
  name: string;
  motto: string;
  default: boolean;
  filters: WheelFilters;
  scoringWeights: {
    put: ScoreWeights;
    call: ScoreWeights;
  };
}

export interface ScoreWeights {
  yield: number;
  deltaFit: number;
  dteFit: number;
  liquidity: number;
  technicalFit: number;
  eventRisk: number;
  volatilityRisk: number;
  assignmentQuality?: number;
  upsideCapQuality?: number;
  thetaEfficiency?: number;
}

export interface ScoreBreakdown {
  yield: number;
  deltaFit: number;
  dteFit: number;
  liquidity: number;
  technicalFit: number;
  eventRisk: number;
  volatilityRisk: number;
  assignmentQuality?: number;
  upsideCapQuality?: number;
  thetaEfficiency?: number;
}

export interface Warning {
  type:
    | "earnings"
    | "liquidity"
    | "volatility"
    | "trend"
    | "upside_cap"
    | "data_quality";
  severity: "info" | "warning" | "danger";
  message: string;
}

export interface UnderlyingContext {
  symbol: string;
  price: number;
  asOf: string;
  trend: Trend;
  rsi14: number | null;
  movingAverages: {
    ma20: number | null;
    ma50: number | null;
    ma200: number | null;
  };
}

export interface RawOptionContract {
  contractSymbol: string;
  optionType: OptionType;
  strike: number;
  expirationDate: string;
  bid: number;
  ask: number;
  delta: number | null;
  theta: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
}

export interface WheelCandidate {
  rank: number;
  score: number;
  contractSymbol: string;
  optionType: OptionType;
  strike: number;
  expirationDate: string;
  dte: number;
  bid: number;
  ask: number;
  midpoint: number;
  spread: number;
  spreadPctOfMid: number;
  premiumYield: number;
  annualizedYield: number;
  delta: number | null;
  theta: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
  distanceFromSpotPct: number;
  breakeven?: number;
  calledAwayPrice?: number;
  assignmentQuality?: QualityLabel;
  upsideCapQuality?: QualityLabel;
  liquidityQuality: QualityLabel;
  warnings: Warning[];
  scoreBreakdown: ScoreBreakdown;
}

export type VerticalSpreadStrategy =
  | "put_credit_spread"
  | "call_credit_spread";

export interface SpreadLeg {
  contractSymbol: string;
  strike: number;
  bid: number;
  ask: number;
  midpoint: number;
  delta: number | null;
  theta: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
}

export interface VerticalSpreadCandidate {
  rank: number;
  score: number;
  id: string;
  strategy: VerticalSpreadStrategy;
  optionType: OptionType;
  shortLeg: SpreadLeg;
  longLeg: SpreadLeg;
  expirationDate: string;
  dte: number;
  width: number;
  netCredit: number;
  maxLoss: number;
  returnOnRisk: number;
  annualizedReturnOnRisk: number;
  breakeven: number;
  shortDelta: number | null;
  netDelta: number | null;
  netTheta: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
  distanceFromSpotPct: number;
  spreadPctOfCredit: number;
  liquidityQuality: QualityLabel;
  definedRiskQuality: QualityLabel;
  warnings: Warning[];
  scoreBreakdown: ScoreBreakdown;
}

export interface WheelAnalysisRequest {
  ticker: string;
  persona: PersonaId;
  filters?: Partial<WheelFilters>;
  resultLimit?: number;
  forceRefresh?: boolean;
}

export type WheelCompanyStrategy =
  | "short_put"
  | "covered_call"
  | "put_credit_spread"
  | "call_credit_spread";

export interface WheelCompanyCandidateSummary {
  strategy: WheelCompanyStrategy;
  score: number;
  expirationDate: string;
  dte: number;
  shortStrike: number;
  longStrike?: number;
  premiumYield?: number;
  annualizedYield?: number;
  returnOnRisk?: number;
  annualizedReturnOnRisk?: number;
  delta: number | null;
  impliedVolatility: number | null;
  liquidityQuality: QualityLabel;
  warningCount: number;
}

export interface WheelCompanyScore {
  rank: number;
  ticker: string;
  name: string;
  exchange: "NYSE" | "NASDAQ";
  score: number;
  underlying: UnderlyingContext;
  bestCandidate: WheelCompanyCandidateSummary;
  warnings: Warning[];
  errors: string[];
}

export interface WheelScreenerRequest {
  persona: PersonaId;
  filters?: Partial<WheelFilters>;
  limit?: number;
  forceRefresh?: boolean;
}

export interface WheelScreenerResponse {
  persona: Pick<PersonaConfig, "id" | "name" | "motto">;
  dataFreshness: {
    feed: DataFeed;
    cacheStatus: CacheStatus;
    asOf: string;
    nextSuggestedRefreshAt: string | null;
  };
  companies: WheelCompanyScore[];
  screenedCount: number;
  skippedCount: number;
  warnings: Warning[];
  errors: string[];
}

export interface WheelAnalysisResponse {
  ticker: string;
  underlying: UnderlyingContext;
  persona: Pick<PersonaConfig, "id" | "name" | "motto">;
  dataFreshness: {
    feed: DataFeed;
    cacheStatus: CacheStatus;
    asOf: string;
    nextSuggestedRefreshAt: string | null;
  };
  shortPuts: WheelCandidate[];
  coveredCalls: WheelCandidate[];
  putCreditSpreads: VerticalSpreadCandidate[];
  callCreditSpreads: VerticalSpreadCandidate[];
  warnings: Warning[];
  errors: string[];
}

export interface SavedPreset {
  id: string;
  name: string;
  basePersona: PersonaId;
  filters: Partial<WheelFilters>;
  createdAt: string;
  updatedAt: string;
}
