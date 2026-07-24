import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { copyAuthCookies } from "./account-session";
import { getSupabaseAuthConfig } from "./auth";
import { createSupabaseRouteClient } from "./server";

const EXACT_SESSION_ROUTES = new Set([
  "/api/auth/account-state",
  "/api/auth/logout",
  "/api/auth/profile",
]);

export function shouldRefreshSession(pathname: string) {
  return pathname === "/account" ||
    pathname.startsWith("/account/") ||
    pathname === "/api/account" ||
    pathname.startsWith("/api/account/") ||
    pathname === "/api/presets" ||
    pathname.startsWith("/api/presets/") ||
    EXACT_SESSION_ROUTES.has(pathname);
}

export function supabaseAuthCookieName(supabaseUrl: string) {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];

    return projectRef ? `sb-${projectRef}-auth-token` : null;
  } catch {
    return null;
  }
}

export function hasSupabaseSessionCookie(
  request: Pick<NextRequest, "cookies">,
  supabaseUrl: string,
) {
  const cookieName = supabaseAuthCookieName(supabaseUrl);

  if (!cookieName) {
    return false;
  }

  return request.cookies.getAll().some((cookie) => {
    if (!cookie.value) {
      return false;
    }

    if (cookie.name === cookieName) {
      return true;
    }

    const chunkPrefix = `${cookieName}.`;

    return cookie.name.startsWith(chunkPrefix) &&
      /^(0|[1-9][0-9]*)$/.test(cookie.name.slice(chunkPrefix.length));
  });
}

export async function refreshSupabaseSession(request: NextRequest) {
  const response = NextResponse.next({ request });

  if (!shouldRefreshSession(request.nextUrl.pathname)) {
    return response;
  }

  const authConfig = getSupabaseAuthConfig();

  if (
    !authConfig ||
    !hasSupabaseSessionCookie(request, authConfig.url)
  ) {
    return response;
  }

  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    return response;
  }

  await supabase.auth.getUser().catch(() => null);

  return copyAuthCookies(response, NextResponse.next({ request }));
}
