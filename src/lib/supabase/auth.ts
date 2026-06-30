import { getEnv } from "@/lib/env";

export interface SupabaseAuthConfig {
  anonKey: string;
  url: string;
}

export interface SupabaseAuthUser {
  app_metadata?: Record<string, unknown>;
  aud?: string;
  email?: string;
  id: string;
  user_metadata?: Record<string, unknown>;
}

function normalizeBaseUrl(url: string) {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export function normalizeAccountEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getSupabaseAuthConfig(): SupabaseAuthConfig | null {
  const env = getEnv();
  const url =
    env.NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL ??
    env.ALPHA_DOG_SUPABASE_URL ??
    env.SUPABASE_URL;
  const anonKey =
    env.NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY ??
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return {
    anonKey,
    url: normalizeBaseUrl(url),
  };
}

export function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");

  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export async function getAuthenticatedSupabaseUser(request: Request) {
  const config = getSupabaseAuthConfig();
  const token = getBearerToken(request);

  if (!config || !token) {
    return null;
  }

  const response = await fetch(new URL("/auth/v1/user", config.url), {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });

  if (response.status === 401 || response.status === 403) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Supabase Auth returned HTTP ${response.status}.`);
  }

  return await response.json() as SupabaseAuthUser;
}

export function isAccountProfileComplete(profile: {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
} | null) {
  return Boolean(
    profile?.email?.trim() &&
    profile.first_name?.trim() &&
    profile.last_name?.trim(),
  );
}
