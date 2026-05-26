export type RequestState =
  | "idle"
  | "loading"
  | "successFresh"
  | "successStale"
  | "refreshing"
  | "errorNoCache";
