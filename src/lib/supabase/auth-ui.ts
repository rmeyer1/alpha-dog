import { safeRedirectPath } from "./oauth";

export type AuthUiNotice =
  | {
      message: string;
      nextPath: string;
      status: "email_conflict" | "error";
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

function safeProviderLabel(value: string | string[] | undefined) {
  const provider = firstParam(value)?.trim().toLowerCase();

  return provider && /^[a-z][a-z0-9_-]{0,31}$/.test(provider)
    ? provider
    : null;
}

function safeEmailDisplay(value: string | string[] | undefined) {
  const email = firstParam(value)?.trim();

  if (!email || email.length > 254 || /[\r\n<>]/.test(email)) {
    return null;
  }

  return email;
}

export interface AccountProviderLinkPrompt {
  email: string | null;
  nextPath: string;
  provider: string;
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

  if (
    authError === "ACCOUNT_EMAIL_CONFLICT" ||
    authError === "EMAIL_ALREADY_REGISTERED"
  ) {
    const isManualConflict = authError === "EMAIL_ALREADY_REGISTERED";

    return {
      message: isManualConflict
        ? "That email already has an account. Use the existing sign-in method or return to the dashboard."
        : "That provider email already belongs to another account. Use the original sign-in method or return to the dashboard.",
      nextPath,
      status: "email_conflict",
      title: isManualConflict
        ? "Email already registered"
        : "Account conflict needs your attention",
    };
  }

  return {
    message: "The provider could not complete sign-in. Retry from this page or return to the dashboard.",
    nextPath,
    status: "error",
    title: "Sign-in failed",
  };
}

export function accountNextPathFromSearchParams(
  searchParams: AccountSearchParams,
) {
  return safeRedirectPath(firstParam(searchParams.next) ?? "/account");
}

export function accountProviderLinkPromptFromSearchParams(
  searchParams: AccountSearchParams,
): AccountProviderLinkPrompt | null {
  if (firstParam(searchParams.provider_link) !== "required") {
    return null;
  }

  const provider = safeProviderLabel(searchParams.provider);

  if (!provider) {
    return null;
  }

  return {
    email: safeEmailDisplay(searchParams.provider_email ?? searchParams.email),
    nextPath: accountNextPathFromSearchParams(searchParams),
    provider,
  };
}
