import { describe, expect, it } from "vitest";
import {
  accountAuthNoticeFromSearchParams,
  accountNextPathFromSearchParams,
  googleSignInPath,
} from "./auth-ui";

describe("auth UI state", () => {
  it("builds Google sign-in links that preserve safe destinations", () => {
    expect(googleSignInPath("/screeners"))
      .toBe("/api/auth/oauth/google?next=%2Fscreeners");
    expect(googleSignInPath("https://evil.example"))
      .toBe("/api/auth/oauth/google?next=%2Faccount");
  });

  it("extracts safe account next destinations", () => {
    expect(accountNextPathFromSearchParams({ next: "/screeners" }))
      .toBe("/screeners");
    expect(accountNextPathFromSearchParams({ next: "https://evil.example" }))
      .toBe("/account");
  });

  it("maps profile completion callbacks to a profile-required notice", () => {
    expect(accountAuthNoticeFromSearchParams({
      next: "/screeners",
      profile: "complete",
    })).toEqual({
      message: "Add the required profile fields before returning to account-owned workflows.",
      nextPath: "/screeners",
      status: "profile_required",
      title: "Profile completion required",
    });
  });

  it("maps provider cancellation to a recoverable notice", () => {
    expect(accountAuthNoticeFromSearchParams({
      auth_error: "oauth_cancelled",
      next: "/account",
    })).toEqual({
      message: "The provider sign-in was cancelled. You can retry or continue without account features.",
      nextPath: "/account",
      status: "error",
      title: "Sign-in cancelled",
    });
  });

  it("maps provider failures without leaking raw details", () => {
    expect(accountAuthNoticeFromSearchParams({
      auth_error: "oauth_callback_failed",
      next: "//evil.example",
    })).toEqual({
      message: "The provider could not complete sign-in. Retry from this page or return to the dashboard.",
      nextPath: "/account",
      status: "error",
      title: "Sign-in failed",
    });
  });
});
