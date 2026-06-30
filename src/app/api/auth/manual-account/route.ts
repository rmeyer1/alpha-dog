import { NextResponse } from "next/server";
import {
  createManualAccount,
  manualAccountInputSchema,
} from "@/lib/supabase/manual-account";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = manualAccountInputSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_MANUAL_ACCOUNT",
          message: "Manual account payload is invalid.",
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
    return NextResponse.json(
      {
        error: {
          code: result.code,
          message: "An account already exists for this email.",
        },
      },
      { status: 409 },
    );
  }

  const status = result.code === "ACCOUNT_AUTH_NOT_CONFIGURED" ? 503 : 502;

  return NextResponse.json(
    {
      error: {
        code: result.code,
        message: "Manual account creation failed.",
      },
    },
    { status },
  );
}
