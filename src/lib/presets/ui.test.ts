import { describe, expect, it } from "vitest";
import {
  isPresetAccessError,
  presetAccessStateFromApiError,
  presetOperationErrorMessage,
} from "./ui";

describe("preset UI state helpers", () => {
  it("maps unauthenticated preset responses to sign-in gating", () => {
    expect(presetAccessStateFromApiError({
      error: {
        code: "UNAUTHENTICATED",
        message: "Sign in to use saved presets.",
      },
    }, 401)).toEqual({
      message: "Sign in to use saved presets.",
      status: "unauthenticated",
    });
  });

  it("maps incomplete profile responses to profile gating", () => {
    expect(presetAccessStateFromApiError({
      error: {
        code: "PROFILE_INCOMPLETE",
        message: "Complete your account profile to use saved presets.",
      },
    }, 403)).toEqual({
      message: "Complete your account profile to use saved presets.",
      status: "profile_incomplete",
    });
  });

  it("maps unknown preset failures to recoverable errors", () => {
    expect(presetAccessStateFromApiError(null, 500)).toEqual({
      message: "Unable to load saved presets.",
      status: "error",
    });
    expect(presetAccessStateFromApiError({
      error: {
        code: "PRESET_FORBIDDEN",
        message: "You do not have access to this preset.",
      },
    }, 403)).toEqual({
      message: "You do not have access to this preset.",
      status: "error",
    });
  });

  it("distinguishes access errors from operation errors", () => {
    expect(isPresetAccessError({
      error: { code: "PROFILE_INCOMPLETE" },
    }, 403)).toBe(true);
    expect(isPresetAccessError({
      error: { code: "PRESET_FORBIDDEN" },
    }, 403)).toBe(false);
  });

  it("uses backend operation messages when available", () => {
    expect(presetOperationErrorMessage({
      error: { message: "Preset payload is invalid." },
    }, "Unable to save preset.")).toBe("Preset payload is invalid.");
    expect(presetOperationErrorMessage(null, "Unable to delete preset."))
      .toBe("Unable to delete preset.");
  });
});
