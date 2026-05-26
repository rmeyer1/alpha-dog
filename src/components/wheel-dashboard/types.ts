export type RequestState =
  | "idle"
  | "loading"
  | "successFresh"
  | "successStale"
  | "refreshing"
  | "errorNoCache";

export type StrategyTab = "puts" | "calls" | "putSpreads" | "callSpreads";
