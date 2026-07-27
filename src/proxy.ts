import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import {
  buildPageContentSecurityPolicy,
} from "@/lib/security/headers";
import { refreshSupabaseSession } from "@/lib/supabase/session-middleware";

function documentNonce() {
  return randomBytes(18).toString("base64");
}

export function isDocumentProxyRequest(request: NextRequest) {
  return !request.nextUrl.pathname.startsWith("/api/");
}

export async function proxy(request: NextRequest) {
  if (!isDocumentProxyRequest(request)) {
    return refreshSupabaseSession(request);
  }

  const nonce = documentNonce();
  const contentSecurityPolicy = buildPageContentSecurityPolicy({
    isDevelopment: process.env.NODE_ENV !== "production",
    nonce,
  });
  const requestHeaders = new Headers(request.headers);

  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const response = await refreshSupabaseSession(request, requestHeaders);

  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);

  return response;
}

export const config = {
  matcher: [
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.[^/]+$).*)",
    "/api/account/:path*",
    "/api/presets/:path*",
    "/api/auth/account-state",
    "/api/auth/logout",
    "/api/auth/profile",
  ],
};
