import { instrumentApiRoute } from "@/lib/observability/route";
import { NextRequest, NextResponse } from "next/server";
import {
  createSavedPreset,
  listSavedPresets,
} from "@/lib/presets/store";
import {
  accountSessionErrorResponse,
  copyAuthCookies,
  getRequiredAccountSession,
} from "@/lib/supabase/account-session";
import { savedPresetInputSchema } from "@/lib/wheel/validation";

async function GETHandler(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "saved presets", authResponse);
  }

  const presets = await listSavedPresets(auth.supabase, auth.user.id);

  return copyAuthCookies(auth.response, NextResponse.json({ presets }));
}

async function POSTHandler(request: NextRequest) {
  const authResponse = NextResponse.next();
  const auth = await getRequiredAccountSession(request, authResponse);

  if ("code" in auth) {
    return accountSessionErrorResponse(auth.code, "saved presets", authResponse);
  }

  const json = await request.json().catch(() => null);
  const parsed = savedPresetInputSchema.safeParse(json);

  if (!parsed.success) {
    return copyAuthCookies(
      auth.response,
      NextResponse.json(
        {
          error: {
            code: "INVALID_PRESET",
            message: "Preset payload is invalid.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 },
      ),
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

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/presets" },
  GETHandler,
);

export const POST = instrumentApiRoute(
  { method: "POST", route: "/api/presets" },
  POSTHandler,
);
