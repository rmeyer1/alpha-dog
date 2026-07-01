import type { AccountHubState } from "./account-hub";

export type AccountNavState =
  | {
      status: "unauthenticated";
    }
  | {
      email: string | null;
      missingFields: string[];
      status: "incomplete_profile";
    }
  | {
      displayName: string;
      email: string;
      status: "ready";
    }
  | {
      message: string;
      status: "error";
    };

export function accountNavStateFromHubState(
  state: AccountHubState,
): AccountNavState {
  if (state.status === "unauthenticated") {
    return { status: "unauthenticated" };
  }

  if (state.status === "incomplete_profile") {
    return {
      email: state.email,
      missingFields: state.missingFields,
      status: "incomplete_profile",
    };
  }

  if (state.status === "error") {
    return {
      message: state.message,
      status: "error",
    };
  }

  return {
    displayName: `${state.firstName} ${state.lastName}`,
    email: state.email,
    status: "ready",
  };
}
