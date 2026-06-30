import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  isAccountProfileComplete,
  normalizeAccountEmail,
} from "./auth";

export type SupportedOAuthProvider = "apple" | "google";

export interface OAuthProfileInput {
  display_name: string | null;
  email: string;
  first_name: string;
  id: string;
  last_name: string;
  primary_provider: string | null;
}

export type OAuthProfileResult =
  | { status: "complete"; profile: OAuthProfileInput }
  | { status: "duplicate_email"; email: string }
  | { status: "missing_email" }
  | {
      status: "needs_completion";
      email: string;
      firstName: string | null;
      lastName: string | null;
      provider: string | null;
    };

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function namePartsFromFullName(fullName: string | null) {
  if (!fullName) {
    return { firstName: null, lastName: null };
  }

  const parts = fullName.split(/\s+/).filter(Boolean);

  if (parts.length < 2) {
    return { firstName: parts[0] ?? null, lastName: null };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
  };
}

export function parseOAuthProvider(value: string | undefined) {
  return value === "google" || value === "apple" ? value : null;
}

export function safeRedirectPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/account";
  }

  return value;
}

export function accountAuthErrorUrl(
  requestUrl: string,
  code: string,
  nextPath = "/account",
) {
  const url = new URL("/account", requestUrl);
  url.searchParams.set("auth_error", code);
  url.searchParams.set("next", safeRedirectPath(nextPath));

  return url;
}

export function accountProfileCompletionUrl(
  requestUrl: string,
  nextPath = "/account",
) {
  const url = new URL("/account", requestUrl);
  url.searchParams.set("profile", "complete");
  url.searchParams.set("next", safeRedirectPath(nextPath));

  return url;
}

export function oauthProviderFromUser(user: User) {
  return stringValue(user.app_metadata?.provider) ??
    stringValue(user.identities?.[0]?.provider) ??
    null;
}

export function oauthProfileFromUser(user: User): OAuthProfileResult {
  const metadata = user.user_metadata ?? {};
  const email = stringValue(user.email) ?? stringValue(metadata.email);

  if (!email) {
    return { status: "missing_email" };
  }

  const fullName =
    stringValue(metadata.full_name) ??
    stringValue(metadata.name);
  const splitName = namePartsFromFullName(fullName);
  const firstName =
    stringValue(metadata.first_name) ??
    stringValue(metadata.firstName) ??
    stringValue(metadata.given_name) ??
    splitName.firstName;
  const lastName =
    stringValue(metadata.last_name) ??
    stringValue(metadata.lastName) ??
    stringValue(metadata.family_name) ??
    splitName.lastName;
  const provider = oauthProviderFromUser(user);

  if (!firstName || !lastName) {
    return {
      email: normalizeAccountEmail(email),
      firstName,
      lastName,
      provider,
      status: "needs_completion",
    };
  }

  return {
    profile: {
      display_name: fullName,
      email,
      first_name: firstName,
      id: user.id,
      last_name: lastName,
      primary_provider: provider,
    },
    status: "complete",
  };
}

export async function ensureOAuthAccountProfile(
  supabase: SupabaseClient,
  user: User,
): Promise<OAuthProfileResult> {
  const profile = oauthProfileFromUser(user);

  if (profile.status !== "complete") {
    return profile;
  }

  const { data: existingProfile, error: selectError } = await supabase
    .from("account_profiles")
    .select("email, first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  if (selectError) {
    throw new Error("Unable to load account profile.");
  }

  if (existingProfile) {
    if (!isAccountProfileComplete(existingProfile)) {
      return {
        email: normalizeAccountEmail(profile.profile.email),
        firstName: existingProfile.first_name ?? null,
        lastName: existingProfile.last_name ?? null,
        provider: profile.profile.primary_provider,
        status: "needs_completion",
      };
    }

    return profile;
  }

  const { error: insertError } = await supabase
    .from("account_profiles")
    .insert(profile.profile);

  if (!insertError) {
    return profile;
  }

  if (insertError.code === "23505") {
    return {
      email: normalizeAccountEmail(profile.profile.email),
      status: "duplicate_email",
    };
  }

  throw new Error("Unable to create account profile.");
}
