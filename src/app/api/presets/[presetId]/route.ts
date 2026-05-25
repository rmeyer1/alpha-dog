import { NextResponse } from "next/server";
import {
  deleteSavedPreset,
  updateSavedPreset,
} from "@/lib/presets/store";
import { savedPresetInputSchema } from "@/lib/wheel/validation";

interface RouteContext {
  params: Promise<{
    presetId: string;
  }>;
}

export async function PUT(request: Request, context: RouteContext) {
  const { presetId } = await context.params;
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

  const preset = await updateSavedPreset(presetId, parsed.data);

  if (!preset) {
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

  return NextResponse.json({ preset });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { presetId } = await context.params;
  const deleted = await deleteSavedPreset(presetId);

  if (!deleted) {
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

  return NextResponse.json({ ok: true });
}
