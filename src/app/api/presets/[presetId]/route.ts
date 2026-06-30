import { NextRequest, NextResponse } from "next/server";
import {
  deleteSavedPreset,
  getSavedPresetOwner,
  updateSavedPreset,
} from "@/lib/presets/store";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  copyAuthCookies,
  getRequiredAccountSession,
  PROFILE_INCOMPLETE,
  UNAUTHENTICATED,
} from "@/lib/supabase/account-session";
import { savedPresetInputSchema } from "@/lib/wheel/validation";

interface RouteContext {
  params: Promise<{
    presetId: string;
  }>;
}

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

async function missingPresetResponse(presetId: string, userId: string) {
  const admin = getSupabaseAdminClient();
  const owner = admin ? await getSavedPresetOwner(admin, presetId) : null;

  if (owner && owner !== userId) {
    return NextResponse.json(
      {
        error: {
          code: "PRESET_FORBIDDEN",
          message: "You do not have access to this preset.",
        },
      },
      { status: 403 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "PRESET_NOT_FOUND",
        message: "Preset was not found.",
      },
    },
    { status: 404 },
  );
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { presetId } = await context.params;
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

  const preset = await updateSavedPreset(
    auth.supabase,
    auth.user.id,
    presetId,
    parsed.data,
  );

  if (!preset) {
    return missingPresetResponse(presetId, auth.user.id);
  }

  return copyAuthCookies(auth.response, NextResponse.json({ preset }));
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { presetId } = await context.params;
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return authErrorResponse(auth.code);
  }

  const deleted = await deleteSavedPreset(
    auth.supabase,
    auth.user.id,
    presetId,
  );

  if (!deleted) {
    return missingPresetResponse(presetId, auth.user.id);
  }

  return copyAuthCookies(auth.response, NextResponse.json({ ok: true }));
}
