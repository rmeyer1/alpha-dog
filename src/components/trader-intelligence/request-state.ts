import { useReducer } from "react";

export type RequestState =
  | "idle"
  | "loading"
  | "refreshing"
  | "success"
  | "error";

export interface AsyncRequestState {
  listError: string | null;
  listState: RequestState;
  profileError: string | null;
  profileLoading: boolean;
}

export type AsyncRequestAction =
  | { type: "list/start" }
  | { type: "list/success" }
  | { type: "list/error"; message: string }
  | { type: "list/reset" }
  | { type: "profile/start" }
  | { type: "profile/success" }
  | { type: "profile/error"; message: string }
  | { type: "profile/reset" };

export const initialAsyncRequestState: AsyncRequestState = {
  listError: null,
  listState: "idle",
  profileError: null,
  profileLoading: false,
};

export function asyncRequestReducer(
  state: AsyncRequestState,
  action: AsyncRequestAction,
): AsyncRequestState {
  switch (action.type) {
    case "list/start":
      return {
        ...state,
        listError: null,
        listState: state.listState === "success" ? "refreshing" : "loading",
      };
    case "list/success":
      return { ...state, listState: "success" };
    case "list/error":
      return { ...state, listError: action.message, listState: "error" };
    case "list/reset":
      return { ...state, listError: null, listState: "idle" };
    case "profile/start":
      return { ...state, profileError: null, profileLoading: true };
    case "profile/success":
      return { ...state, profileLoading: false };
    case "profile/error":
      return { ...state, profileError: action.message, profileLoading: false };
    case "profile/reset":
      return { ...state, profileError: null, profileLoading: false };
  }
}

export function useAsyncRequestState() {
  return useReducer(asyncRequestReducer, initialAsyncRequestState);
}
