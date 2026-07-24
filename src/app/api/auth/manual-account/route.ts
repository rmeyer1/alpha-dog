import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import {
  createManualAccount,
  manualAccountInviteRedirectUrl,
  manualAccountInputSchema,
} from "@/lib/supabase/manual-account";
import {
  acquireManualAccountInviteGuard,
  manualAccountRequestIp,
  verifyManualAccountChallenge,
} from "@/lib/supabase/manual-account-protection";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  authCorrelationIdFromRequest,
  logAuthAccountFailure,
} from "@/lib/supabase/auth-observability";

function acceptedResponse(correlationId: string) {
  return NextResponse.json(
    {
      correlationId,
      message: "If this email is eligible, an invitation will arrive shortly.",
      status: "accepted",
    },
    { status: 202 },
  );
}

function errorResponse(
  code: string,
  correlationId: string,
  message: string,
  status: number,
) {
  return NextResponse.json(
    { error: { code, correlationId, message } },
    { status },
  );
}

async function POSTHandler(request: Request) {
  const correlationId = authCorrelationIdFromRequest(request);
  const json = await request.json().catch(() => null);
  const parsed = manualAccountInputSchema.safeParse(json);

  if (!parsed.success) {
    logAuthAccountFailure({
      code: "INVALID_MANUAL_ACCOUNT",
      correlationId,
      operation: "manual_account",
    });

    return NextResponse.json(
      {
        error: {
          code: "INVALID_MANUAL_ACCOUNT",
          message: "Manual account payload is invalid.",
          correlationId,
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const redirectTo = manualAccountInviteRedirectUrl(
    request.url,
    parsed.data.nextPath,
  );

  if (!redirectTo) {
    logAuthAccountFailure({
      code: "MANUAL_ACCOUNT_REDIRECT_NOT_CONFIGURED",
      correlationId,
      operation: "manual_account",
    });

    return errorResponse(
      "MANUAL_ACCOUNT_UNAVAILABLE",
      correlationId,
      "Manual account creation is temporarily unavailable.",
      503,
    );
  }

  const guard = await acquireManualAccountInviteGuard(
    request,
    parsed.data.email,
  );

  if (!guard.allowed) {
    if (guard.reason === "limited") {
      logAuthAccountFailure({
        code: "MANUAL_ACCOUNT_THROTTLED",
        correlationId,
        operation: "manual_account",
      });

      return acceptedResponse(correlationId);
    }

    logAuthAccountFailure({
      code: "MANUAL_ACCOUNT_PROTECTION_UNAVAILABLE",
      correlationId,
      operation: "manual_account",
    });

    return errorResponse(
      "MANUAL_ACCOUNT_UNAVAILABLE",
      correlationId,
      "Manual account creation is temporarily unavailable.",
      503,
    );
  }

  try {
    const challenge = await verifyManualAccountChallenge({
      remoteIp: manualAccountRequestIp(request),
      signal: request.signal,
      token: parsed.data.captchaToken,
    });

    if (challenge.status !== "verified") {
      const unavailable = challenge.status === "unavailable";

      logAuthAccountFailure({
        code: unavailable
          ? "BOT_CHALLENGE_UNAVAILABLE"
          : "BOT_CHALLENGE_FAILED",
        correlationId,
        operation: "manual_account",
      });

      return errorResponse(
        unavailable ? "MANUAL_ACCOUNT_UNAVAILABLE" : "BOT_CHALLENGE_FAILED",
        correlationId,
        unavailable
          ? "Manual account creation is temporarily unavailable."
          : "Verification failed. Please try again.",
        unavailable ? 503 : 400,
      );
    }

    const result = await createManualAccount(
      {
        email: parsed.data.email,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        redirectTo,
      },
      getSupabaseAdminClient(),
    );

    if (result.status === "invite_sent") {
      return acceptedResponse(correlationId);
    }

    if (result.status === "email_conflict") {
      logAuthAccountFailure({
        code: result.code,
        correlationId,
        operation: "manual_account",
      });

      return acceptedResponse(correlationId);
    }

    const status = result.code === "ACCOUNT_AUTH_NOT_CONFIGURED" ? 503 : 502;

    logAuthAccountFailure({
      code: result.code,
      correlationId,
      operation: "manual_account",
    });

    return errorResponse(
      result.code,
      correlationId,
      "Manual account creation failed.",
      status,
    );
  } finally {
    await guard.release();
  }
}

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/auth/manual-account" },
  POSTHandler,
);
