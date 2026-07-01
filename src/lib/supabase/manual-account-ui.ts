import { safeRedirectPath } from "./oauth";

export interface ManualAccountFields {
  email: string;
  firstName: string;
  lastName: string;
}

export interface ManualAccountFieldErrors {
  email?: string;
  firstName?: string;
  lastName?: string;
}

interface ManualAccountErrorPayload {
  error?: {
    code?: string;
    details?: {
      fieldErrors?: Record<string, string[] | undefined>;
    };
    message?: string;
  };
}

const EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED";

function firstError(errors: Record<string, string[] | undefined> | undefined, key: string) {
  return errors?.[key]?.[0];
}

export function validateManualAccountFields(
  fields: ManualAccountFields,
): ManualAccountFieldErrors {
  const errors: ManualAccountFieldErrors = {};
  const email = fields.email.trim();

  if (!fields.firstName.trim()) {
    errors.firstName = "First name is required.";
  }

  if (!fields.lastName.trim()) {
    errors.lastName = "Last name is required.";
  }

  if (!email) {
    errors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid email address.";
  }

  return errors;
}

export function manualAccountConflictPath(nextPath: string) {
  const params = new URLSearchParams({
    auth_error: EMAIL_ALREADY_REGISTERED,
    next: safeRedirectPath(nextPath),
  });

  return `/account?${params.toString()}`;
}

export function manualAccountRedirectTo(origin: string, nextPath: string) {
  const url = new URL("/account", origin);
  url.searchParams.set("profile", "complete");
  url.searchParams.set("next", safeRedirectPath(nextPath));

  return url.toString();
}

export function manualAccountErrorsFromPayload(
  payload: ManualAccountErrorPayload | null,
) {
  const fieldErrors = payload?.error?.details?.fieldErrors;
  const mappedFieldErrors: ManualAccountFieldErrors = {
    email: firstError(fieldErrors, "email"),
    firstName: firstError(fieldErrors, "firstName"),
    lastName: firstError(fieldErrors, "lastName"),
  };
  const hasFieldErrors = Boolean(
    mappedFieldErrors.email ||
      mappedFieldErrors.firstName ||
      mappedFieldErrors.lastName,
  );

  return {
    conflict: payload?.error?.code === EMAIL_ALREADY_REGISTERED,
    fieldErrors: mappedFieldErrors,
    formError: hasFieldErrors
      ? null
      : payload?.error?.message ?? "Manual account creation failed.",
  };
}
