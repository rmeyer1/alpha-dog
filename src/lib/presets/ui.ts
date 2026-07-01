export type PresetAccessState =
  | {
      message: string;
      status: "loading";
    }
  | {
      message: string;
      status: "unauthenticated";
    }
  | {
      message: string;
      status: "profile_incomplete";
    }
  | {
      message: string;
      status: "error";
    }
  | {
      status: "ready";
    };

interface PresetApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

export function presetAccessStateFromApiError(
  payload: PresetApiErrorPayload | null,
  status: number,
): PresetAccessState {
  const code = payload?.error?.code;
  const message = payload?.error?.message;

  if (status === 401 || code === "UNAUTHENTICATED") {
    return {
      message: message ?? "Sign in to use saved presets.",
      status: "unauthenticated",
    };
  }

  if (code === "PROFILE_INCOMPLETE") {
    return {
      message: message ?? "Complete your account profile to use saved presets.",
      status: "profile_incomplete",
    };
  }

  return {
    message: message ?? "Unable to load saved presets.",
    status: "error",
  };
}

export function isPresetAccessError(
  payload: PresetApiErrorPayload | null,
  status: number,
) {
  return status === 401 ||
    payload?.error?.code === "UNAUTHENTICATED" ||
    payload?.error?.code === "PROFILE_INCOMPLETE";
}

export function presetOperationErrorMessage(
  payload: PresetApiErrorPayload | null,
  fallback: string,
) {
  return payload?.error?.message ?? fallback;
}
