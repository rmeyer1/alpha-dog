import { safeRedirectPath } from "./oauth";

export type AuthUiNotice =
  | {
      message: string;
      nextPath: string;
      status: "error";
      title: string;
    }
  | {
      message: string;
      nextPath: string;
      status: "profile_required";
      title: string;
    }
  | null;

export type AccountSearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function googleSignInPath(nextPath = "/account") {
  const params = new URLSearchParams({
    next: safeRedirectPath(nextPath),
  });

  return `/api/auth/oauth/google?${params.toString()}`;
}

export function accountAuthNoticeFromSearchParams(
  searchParams: AccountSearchParams,
): AuthUiNotice {
  const nextPath = safeRedirectPath(firstParam(searchParams.next) ?? "/account");
  const authError = firstParam(searchParams.auth_error);
  const profile = firstParam(searchParams.profile);

  if (profile === "complete") {
    return {
      message: "Add the required profile fields before returning to account-owned workflows.",
      nextPath,
      status: "profile_required",
      title: "Profile completion required",
    };
  }

  if (!authError) {
    return null;
  }

  if (authError === "oauth_cancelled") {
    return {
      message: "The provider sign-in was cancelled. You can retry or continue without account features.",
      nextPath,
      status: "error",
      title: "Sign-in cancelled",
    };
  }

  if (authError === "ACCOUNT_EMAIL_CONFLICT") {
    return {
      message: "That email is already connected to another account. Use the original sign-in method or create a manual-account flow.",
      nextPath,
      status: "error",
      title: "Email already registered",
    };
  }

  return {
    message: "The provider could not complete sign-in. Retry from this page or return to the dashboard.",
    nextPath,
    status: "error",
    title: "Sign-in failed",
  };
}
