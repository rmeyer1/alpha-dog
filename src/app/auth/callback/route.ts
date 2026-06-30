import { NextRequest, NextResponse } from "next/server";
import {
  accountAuthErrorUrl,
  accountProfileCompletionUrl,
  ensureOAuthAccountProfile,
  safeRedirectPath,
} from "@/lib/supabase/oauth";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");
  const nextPath = safeRedirectPath(request.nextUrl.searchParams.get("next"));

  if (providerError) {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "oauth_cancelled", nextPath),
      { status: 303 },
    );
  }

  if (!code) {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "missing_oauth_code", nextPath),
      { status: 303 },
    );
  }

  const destination = new URL(nextPath, request.url);
  const response = NextResponse.redirect(destination, { status: 303 });
  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "auth_not_configured", nextPath),
      { status: 303 },
    );
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "oauth_callback_failed", nextPath),
      { status: 303 },
    );
  }

  const profileResult = await ensureOAuthAccountProfile(supabase, data.user);

  if (profileResult.status === "complete") {
    return response;
  }

  if (profileResult.status === "duplicate_email") {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "duplicate_email", nextPath),
      { status: 303 },
    );
  }

  if (profileResult.status === "missing_email") {
    return NextResponse.redirect(
      accountAuthErrorUrl(request.url, "missing_email", nextPath),
      { status: 303 },
    );
  }

  return NextResponse.redirect(
    accountProfileCompletionUrl(request.url, nextPath),
    { status: 303 },
  );
}
