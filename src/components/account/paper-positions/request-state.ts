import { useReducer } from "react";
import type { DetailState, LoadState, PositionTab } from "./contracts";

export type RequestState = { detail: DetailState; positions: LoadState };
export type RequestAction =
  | { type: "positions/loading" }
  | { state: LoadState; type: "positions/received" }
  | { scope: PositionTab; type: "positions/page-loading" }
  | { update: (state: LoadState) => LoadState; type: "positions/update" }
  | { type: "detail/loading"; id: string }
  | { state: DetailState; type: "detail/received" }
  | { update: (state: DetailState) => DetailState; type: "detail/update" }
  | { type: "detail/closed" };

export function paperPositionsRequestReducer(
  state: RequestState,
  action: RequestAction,
): RequestState {
  switch (action.type) {
    case "positions/loading":
      return { ...state, positions: { status: "loading" } };
    case "positions/received":
      return { ...state, positions: action.state };
    case "positions/page-loading":
      return state.positions.status !== "ready"
        ? state
        : {
            ...state,
            positions: {
              ...state.positions,
              announcement: `Loading more ${action.scope === "open" ? "open" : "historical"} positions.`,
              pageError: {
                ...state.positions.pageError,
                [action.scope]: undefined,
              },
              pageLoading: action.scope,
            },
          };
    case "positions/update":
      return { ...state, positions: action.update(state.positions) };
    case "detail/loading":
      return { ...state, detail: { id: action.id, status: "loading" } };
    case "detail/received":
      return { ...state, detail: action.state };
    case "detail/update":
      return { ...state, detail: action.update(state.detail) };
    case "detail/closed":
      return { ...state, detail: { status: "idle" } };
  }
}

export function usePaperPositionsRequestState() {
  return useReducer(paperPositionsRequestReducer, {
    detail: { status: "idle" } as DetailState,
    positions: { status: "loading" } as LoadState,
  });
}
