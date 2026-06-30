import { NextRequest, NextResponse } from "next/server";
import {
  accountAuthErrorUrl,
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

  if (!provider) {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "unsupported_provider", nextPath),
      { status: 303 },
    );
  }

  const response = new NextResponse(null, { status: 302 });
  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "auth_not_configured", nextPath),
      { status: 303 },
    );
  }

  const redirectTo = new URL("/auth/callback", request.url);
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
      accountAuthErrorUrl(request.url, "oauth_start_failed", nextPath),
      { status: 303 },
    );
  }

  response.headers.set("Location", data.url);

  return response;
}
