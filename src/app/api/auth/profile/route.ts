import { NextRequest, NextResponse } from "next/server";
import {
  copyAuthCookies,
} from "@/lib/supabase/account-session";
import {
  completeAccountProfile,
  profileCompletionInputSchema,
  PROFILE_AUTH_NOT_CONFIGURED,
  PROFILE_UNAUTHENTICATED,
} from "@/lib/supabase/profile-completion";
import { createSupabaseRouteClient } from "@/lib/supabase/server";

function errorStatus(code: string) {
  if (code === PROFILE_UNAUTHENTICATED) {
    return 401;
  }

  if (code === PROFILE_AUTH_NOT_CONFIGURED) {
    return 503;
  }

  return code === "ACCOUNT_EMAIL_CONFLICT" ? 409 : 502;
}

export async function PATCH(request: NextRequest) {
  const json = await request.json().catch(() => null);
  const parsed = profileCompletionInputSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PROFILE",
          message: "Profile payload is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ status: "complete" });
  const result = await completeAccountProfile(
    parsed.data,
    createSupabaseRouteClient(request, response),
  );

  if (result.status === "error") {
    return NextResponse.json(
      {
        error: {
          code: result.code,
          message: result.code === "ACCOUNT_EMAIL_CONFLICT"
            ? "That email is already connected to another account."
            : "Profile completion failed.",
        },
      },
      { status: errorStatus(result.code) },
    );
  }

  return copyAuthCookies(response, NextResponse.json(result));
}
