import type {
  JsonValue,
  TradeAnalysisResponse,
} from "@/lib/trade-analysis/types";
import type {
  PersonaConfig,
  UnderlyingContext,
  WheelCompanyStrategy,
} from "@/lib/wheel/types";

export type RequestState =
  | "idle"
  | "loading"
  | "successFresh"
  | "successStale"
  | "refreshing"
  | "errorNoCache";

export type StrategyTab = "puts" | "calls" | "putSpreads" | "callSpreads";

export interface CandidateAnalysisContext {
  dataFreshness: JsonValue;
  filters: JsonValue;
  persona: Pick<PersonaConfig, "id" | "name" | "motto">;
  source: "wheel_dashboard" | "company_dashboard";
  ticker: string;
  underlying: UnderlyingContext;
}

export interface CandidateAnalysisState {
  error?: string;
  response?: TradeAnalysisResponse;
  status: "idle" | "loading" | "success" | "error";
}

export type AnalyzeCandidateHandler<T> = (
  candidate: T,
  strategy: WheelCompanyStrategy,
) => void;
