import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createSupabaseRouteClient } from "./server";

const STATIC_FILE_PATTERN = /\/[^/]+\.[^/]+$/;

export function shouldRefreshSession(pathname: string) {
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    STATIC_FILE_PATTERN.test(pathname)
  ) {
    return false;
  }

  if (
    pathname === "/auth/callback" ||
    pathname.startsWith("/api/auth/oauth/") ||
    pathname.startsWith("/api/cron/")
  ) {
    return false;
  }

  return true;
}

export async function refreshSupabaseSession(request: NextRequest) {
  const response = NextResponse.next();

  if (!shouldRefreshSession(request.nextUrl.pathname)) {
    return response;
  }

  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    return response;
  }

  await supabase.auth.getUser().catch(() => null);

  return response;
}
