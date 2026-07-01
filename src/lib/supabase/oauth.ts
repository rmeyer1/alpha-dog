import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  isAccountProfileComplete,
  normalizeAccountEmail,
} from "./auth";

export type SupportedOAuthProvider = "apple" | "google";

export const ACCOUNT_EMAIL_CONFLICT = "ACCOUNT_EMAIL_CONFLICT";
export const EMAIL_ALREADY_REGISTERED = "EMAIL_ALREADY_REGISTERED";

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
  | {
      code: typeof ACCOUNT_EMAIL_CONFLICT;
      email: string;
      provider: string | null;
      status: "email_conflict";
    }
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

function firstIdentity(user: User) {
  return user.identities?.[0] as Record<string, unknown> | undefined;
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

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function normalizedOrigin(origin: string | null) {
  if (!origin) {
    return null;
  }

  try {
    const url = new URL(origin);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(origin: string) {
  const hostname = new URL(origin).hostname;

  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
}

export function appOriginFromHeaders(requestUrl: string, headers: Headers) {
  const forwardedHost = firstForwardedValue(headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstForwardedValue(headers.get("host"));
  const forwardedProto = firstForwardedValue(headers.get("x-forwarded-proto"));
  const fallbackUrl = new URL(requestUrl);
  const proto = forwardedProto ?? fallbackUrl.protocol.replace(/:$/, "");
  const forwardedOrigin = host
    ? normalizedOrigin(`${proto}://${host}`)
    : null;
  const vercelUrl = firstForwardedValue(process.env.VERCEL_URL ?? null);
  const vercelOrigin = vercelUrl
    ? normalizedOrigin(
        vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`,
      )
    : null;

  if (forwardedOrigin && !isLocalhostOrigin(forwardedOrigin)) {
    return forwardedOrigin;
  }

  return vercelOrigin ?? forwardedOrigin ?? fallbackUrl.origin;
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
    stringValue(firstIdentity(user)?.provider) ??
    null;
}

export function oauthProviderUserIdFromUser(user: User) {
  const identity = firstIdentity(user);

  return stringValue(identity?.id) ??
    stringValue(identity?.identity_id) ??
    stringValue(identity?.user_id) ??
    user.id;
}

export function manualDuplicateEmailResult(email: string) {
  return {
    code: EMAIL_ALREADY_REGISTERED,
    email: normalizeAccountEmail(email),
    status: "email_conflict" as const,
  } as const;
}

export function oauthEmailConflictResult(email: string, provider: string | null) {
  return {
    code: ACCOUNT_EMAIL_CONFLICT,
    email: normalizeAccountEmail(email),
    provider,
    status: "email_conflict" as const,
  } as const;
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
      email: normalizeAccountEmail(email),
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

    await recordOAuthAccountIdentity(supabase, user);

    return profile;
  }

  const { error: insertError } = await supabase
    .from("account_profiles")
    .insert(profile.profile);

  if (!insertError) {
    await recordOAuthAccountIdentity(supabase, user);

    return profile;
  }

  if (insertError.code === "23505") {
    return oauthEmailConflictResult(
      profile.profile.email,
      profile.profile.primary_provider,
    );
  }

  throw new Error("Unable to create account profile.");
}

export async function recordOAuthAccountIdentity(
  supabase: SupabaseClient,
  user: User,
) {
  const provider = oauthProviderFromUser(user);
  const providerUserId = oauthProviderUserIdFromUser(user);

  if (!provider || !providerUserId) {
    return { recorded: false as const, reason: "missing_provider_identity" };
  }

  const { error } = await supabase
    .from("account_identities")
    .upsert(
      {
        provider,
        provider_email: user.email ?? null,
        provider_user_id: providerUserId,
        user_id: user.id,
      },
      {
        ignoreDuplicates: true,
        onConflict: "provider,provider_user_id",
      },
    );

  if (error) {
    throw new Error("Unable to record account identity.");
  }

  return { recorded: true as const };
}
