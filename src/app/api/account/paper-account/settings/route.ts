import { NextResponse, type NextRequest } from "next/server";
import {
  paperAccountSettingsSchema,
  updatePaperAccountSettings,
} from "@/lib/account/simulated-account-portfolio";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";

export async function PATCH(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "paper account");
  }

  const json = await request.json().catch(() => null);
  const parsed = paperAccountSettingsSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PAPER_ACCOUNT_SETTINGS",
          message: "Paper account settings payload is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const account = await updatePaperAccountSettings(
    auth.supabase,
    auth.user.id,
    parsed.data,
  );

  return copyAuthCookies(auth.response, NextResponse.json({ account }));
}
