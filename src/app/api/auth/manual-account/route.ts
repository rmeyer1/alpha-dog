import { NextResponse } from "next/server";
import {
  createManualAccount,
  manualAccountInputSchema,
} from "@/lib/supabase/manual-account";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  authCorrelationIdFromRequest,
  logAuthAccountFailure,
} from "@/lib/supabase/auth-observability";

export async function POST(request: Request) {
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

  const result = await createManualAccount(
    parsed.data,
    getSupabaseAdminClient(),
  );

  if (result.status === "invite_sent") {
    return NextResponse.json(result, { status: 201 });
  }

  if (result.status === "email_conflict") {
    logAuthAccountFailure({
      code: result.code,
      correlationId,
      operation: "manual_account",
    });

    return NextResponse.json(
      {
        error: {
          code: result.code,
          correlationId,
          message: "An account already exists for this email.",
        },
      },
      { status: 409 },
    );
  }

  const status = result.code === "ACCOUNT_AUTH_NOT_CONFIGURED" ? 503 : 502;

  logAuthAccountFailure({
    code: result.code,
    correlationId,
    operation: "manual_account",
  });

  return NextResponse.json(
    {
      error: {
        code: result.code,
        correlationId,
        message: "Manual account creation failed.",
      },
    },
    { status },
  );
}
