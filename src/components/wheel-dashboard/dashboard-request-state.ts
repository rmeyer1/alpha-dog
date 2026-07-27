import type {
  PersonaId,
  WheelAnalysisResponse,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerResponse,
} from "@/lib/wheel/types";
import type { WheelDashboardUrlState } from "@/lib/dashboard-url-state";
import type { RequestState } from "./types";

export type DashboardRequestState = {
  error: string | null;
  requestState: RequestState;
  response: WheelAnalysisResponse | null;
  resultIdentity: WheelDashboardUrlState;
  screenerResponse: WheelScreenerResponse | null;
};

export type DashboardRequestAction =
  | { type: "requestStarted"; refresh: boolean }
  | {
      type: "screenerLoaded";
      response: WheelScreenerResponse;
      identity: WheelDashboardUrlState;
    }
  | {
      type: "analysisLoaded";
      response: WheelAnalysisResponse;
      identity: WheelDashboardUrlState;
    }
  | { type: "requestFailed"; message: string }
  | { type: "clearAnalysis" }
  | { type: "clearScreener" }
  | { type: "clearError" };

export function initialDashboardRequestState(
  identity: WheelDashboardUrlState,
): DashboardRequestState {
  return {
    error: null,
    requestState: "idle",
    response: null,
    resultIdentity: identity,
    screenerResponse: null,
  };
}

export function dashboardRequestReducer(
  state: DashboardRequestState,
  action: DashboardRequestAction,
): DashboardRequestState {
  switch (action.type) {
    case "requestStarted":
      return {
        ...state,
        error: null,
        requestState:
          action.refresh ||
          state.requestState === "successFresh" ||
          state.requestState === "successStale" ||
          state.requestState === "refreshing"
            ? "refreshing"
            : "loading",
      };
    case "screenerLoaded":
      return {
        ...state,
        requestState:
          action.response.dataFreshness.cacheStatus === "stale"
            ? "successStale"
            : "successFresh",
        response: null,
        resultIdentity: action.identity,
        screenerResponse: action.response,
      };
    case "analysisLoaded":
      return {
        ...state,
        requestState:
          action.response.dataFreshness.cacheStatus === "stale"
            ? "successStale"
            : "successFresh",
        response: action.response,
        resultIdentity: action.identity,
        screenerResponse: null,
      };
    case "requestFailed":
      return { ...state, error: action.message, requestState: "errorNoCache" };
    case "clearAnalysis":
      return { ...state, response: null };
    case "clearScreener":
      return { ...state, screenerResponse: null };
    case "clearError":
      return { ...state, error: null };
  }
}

export function analysisStrategyForTab(
  tab: WheelDashboardUrlState["tab"],
): WheelCompanyStrategy {
  switch (tab) {
    case "calls":
      return "covered_call";
    case "putSpreads":
      return "put_credit_spread";
    case "callSpreads":
      return "call_credit_spread";
    case "puts":
      return "short_put";
  }
}

export function requestIdentity({
  filters,
  personaId,
  screenerStrategy,
  tab,
  ticker,
}: {
  filters: WheelFilters;
  personaId: PersonaId;
  screenerStrategy: WheelCompanyStrategy;
  tab: WheelDashboardUrlState["tab"];
  ticker: string;
}): WheelDashboardUrlState {
  return { filters, personaId, screenerStrategy, tab, ticker };
}
