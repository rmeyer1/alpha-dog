import { NextRequest, NextResponse } from "next/server";
import {
  createSavedPreset,
  listSavedPresets,
} from "@/lib/presets/store";
import {
  copyAuthCookies,
  getRequiredAccountSession,
  PROFILE_INCOMPLETE,
  UNAUTHENTICATED,
} from "@/lib/supabase/account-session";
import { savedPresetInputSchema } from "@/lib/wheel/validation";

function authErrorResponse(code: typeof UNAUTHENTICATED | typeof PROFILE_INCOMPLETE) {
  return NextResponse.json(
    {
      error: {
        code,
        message: code === UNAUTHENTICATED
          ? "Sign in to use saved presets."
          : "Complete your account profile to use saved presets.",
      },
    },
    { status: code === UNAUTHENTICATED ? 401 : 403 },
  );
}

export async function GET(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return authErrorResponse(auth.code);
  }

  const presets = await listSavedPresets(auth.supabase, auth.user.id);

  return copyAuthCookies(auth.response, NextResponse.json({ presets }));
}

export async function POST(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return authErrorResponse(auth.code);
  }

  const json = await request.json().catch(() => null);
  const parsed = savedPresetInputSchema.safeParse(json);

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_PRESET",
          message: "Preset payload is invalid.",
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const preset = await createSavedPreset(
    auth.supabase,
    auth.user.id,
    parsed.data,
  );

  return copyAuthCookies(
    auth.response,
    NextResponse.json({ preset }, { status: 201 }),
  );
}
