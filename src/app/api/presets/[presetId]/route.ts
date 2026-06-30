import { NextRequest, NextResponse } from "next/server";
import {
  deleteSavedPreset,
  getSavedPresetOwner,
  updateSavedPreset,
} from "@/lib/presets/store";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";
import { savedPresetInputSchema } from "@/lib/wheel/validation";

interface RouteContext {
  params: Promise<{
    presetId: string;
  }>;
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
    return accountSessionErrorResponse(auth.code, "saved presets");
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
    return accountSessionErrorResponse(auth.code, "saved presets");
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
