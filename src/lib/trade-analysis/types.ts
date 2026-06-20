import type {
  PersonaConfig,
  UnderlyingContext,
  WheelCompanyStrategy,
} from "@/lib/wheel/types";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type TradeAnalysisVerdict =
  | "validate"
  | "invalidate"
  | "needs_confirmation"
  | "no_trade";

export type TradeAnalysisChartSource = "server_chart_indicators";

export interface TradeAnalysisResult {
  verdict: TradeAnalysisVerdict;
  confidence: number;
  summary: string;
  setupType: string;
  riskFlags: string[];
  invalidation: string;
  targets: string[];
  managementPlan: string[];
  chartRead: string;
  eventRisk: string;
  disclaimer: string;
  chartSource: TradeAnalysisChartSource;
}

export interface TradeAnalysisCandidateIdentity {
  key: string;
  rank: number | null;
  score: number | null;
}

export interface TradeAnalysisInput {
  candidate: JsonValue;
  candidateIdentity: TradeAnalysisCandidateIdentity;
  candidateType: "contract" | "vertical_spread";
  dataFreshness?: JsonValue;
  filters?: JsonValue;
  persona: Pick<PersonaConfig, "id" | "name" | "motto">;
  source: "wheel_dashboard" | "company_dashboard";
  strategy: WheelCompanyStrategy;
  ticker: string;
  underlying: UnderlyingContext;
}

export interface TradeAnalysisResponse {
  auditId: string | null;
  model: string;
  provider: string;
  promptVersion: string;
  result: TradeAnalysisResult;
}

export interface TradeAnalysisRunRecord {
  candidate_identity: TradeAnalysisCandidateIdentity;
  candidate_type: TradeAnalysisInput["candidateType"];
  chart_source: TradeAnalysisChartSource | null;
  confidence: number | null;
  error: string | null;
  model: string;
  persona: string;
  prompt_version: string;
  provider: string;
  request_payload: JsonValue;
  response_payload: JsonValue | null;
  source: TradeAnalysisInput["source"];
  status: "completed" | "failed";
  strategy: WheelCompanyStrategy;
  symbol: string;
  verdict: TradeAnalysisVerdict | null;
}
