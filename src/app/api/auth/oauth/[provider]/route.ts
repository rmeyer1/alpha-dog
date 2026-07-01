import { NextRequest, NextResponse } from "next/server";
import {
  accountAuthErrorUrl,
  appOriginFromHeaders,
  parseOAuthProvider,
  safeRedirectPath,
} from "@/lib/supabase/oauth";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{
    provider: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { provider: rawProvider } = await context.params;
  const provider = parseOAuthProvider(rawProvider);
  const nextPath = safeRedirectPath(request.nextUrl.searchParams.get("next"));
  const appOrigin = appOriginFromHeaders(request.url, request.headers);

  if (!provider) {
    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "unsupported_provider", nextPath),
      { status: 303 },
    );
  }

  const response = new NextResponse(null, { status: 302 });
  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "auth_not_configured", nextPath),
      { status: 303 },
    );
  }

  const redirectTo = new URL("/auth/callback", appOrigin);
  redirectTo.searchParams.set("next", nextPath);

  const { data, error } = await supabase.auth.signInWithOAuth({
    options: {
      redirectTo: redirectTo.toString(),
      ...(provider === "google"
        ? { queryParams: { access_type: "offline", prompt: "consent" } }
        : {}),
    },
    provider,
  });

  if (error || !data.url) {
    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "oauth_start_failed", nextPath),
      { status: 303 },
    );
  }

  response.headers.set("Location", data.url);

  return response;
}
