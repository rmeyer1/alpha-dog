import { NextRequest, NextResponse } from "next/server";
import {
  accountAuthErrorUrl,
  accountProfileCompletionUrl,
  appOriginFromHeaders,
  ensureOAuthAccountProfile,
  safeRedirectPath,
} from "@/lib/supabase/oauth";
import {
  authCorrelationIdFromRequest,
  logAuthAccountFailure,
} from "@/lib/supabase/auth-observability";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const correlationId = authCorrelationIdFromRequest(request);
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");
  const nextPath = safeRedirectPath(request.nextUrl.searchParams.get("next"));
  const appOrigin = appOriginFromHeaders(request.url, request.headers);

  if (providerError) {
    logAuthAccountFailure({
      code: "OAUTH_CANCELLED",
      correlationId,
      operation: "oauth_callback",
    });

    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "oauth_cancelled", nextPath),
      { status: 303 },
    );
  }

  if (!code) {
    logAuthAccountFailure({
      code: "MISSING_OAUTH_CODE",
      correlationId,
      operation: "oauth_callback",
    });

    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "missing_oauth_code", nextPath),
      { status: 303 },
    );
  }

  const destination = new URL(nextPath, appOrigin);
  const response = NextResponse.redirect(destination, { status: 303 });
  const supabase = createSupabaseRouteClient(request, response);

  if (!supabase) {
    logAuthAccountFailure({
      code: "AUTH_NOT_CONFIGURED",
      correlationId,
      operation: "oauth_callback",
    });

    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "auth_not_configured", nextPath),
      { status: 303 },
    );
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    logAuthAccountFailure({
      code: "OAUTH_CALLBACK_FAILED",
      correlationId,
      operation: "oauth_callback",
    });

    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "oauth_callback_failed", nextPath),
      { status: 303 },
    );
  }

  const profileResult = await ensureOAuthAccountProfile(supabase, data.user)
    .catch(() => null);

  if (!profileResult) {
    logAuthAccountFailure({
      code: "ACCOUNT_PROFILE_CREATE_FAILED",
      correlationId,
      operation: "oauth_callback",
    });

    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "oauth_callback_failed", nextPath),
      { status: 303 },
    );
  }

  if (profileResult.status === "complete") {
    return response;
  }

  if (profileResult.status === "email_conflict") {
    logAuthAccountFailure({
      code: profileResult.code,
      correlationId,
      operation: "oauth_callback",
      provider: profileResult.provider,
    });

    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, profileResult.code, nextPath),
      { status: 303 },
    );
  }

  if (profileResult.status === "missing_email") {
    logAuthAccountFailure({
      code: "MISSING_EMAIL",
      correlationId,
      operation: "oauth_callback",
    });

    return NextResponse.redirect(
      accountAuthErrorUrl(appOrigin, "missing_email", nextPath),
      { status: 303 },
    );
  }

  logAuthAccountFailure({
    code: "PROFILE_INCOMPLETE",
    correlationId,
    operation: "oauth_callback",
    provider: profileResult.provider,
  });

  return NextResponse.redirect(
    accountProfileCompletionUrl(appOrigin, nextPath),
    { status: 303 },
  );
}
