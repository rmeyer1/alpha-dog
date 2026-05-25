import { NextResponse } from "next/server";
import {
  createSavedPreset,
  listSavedPresets,
} from "@/lib/presets/store";
import { savedPresetInputSchema } from "@/lib/wheel/validation";

export async function GET() {
  const presets = await listSavedPresets();

  return NextResponse.json({ presets });
}

export async function POST(request: Request) {
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

  const preset = await createSavedPreset(parsed.data);

  return NextResponse.json({ preset }, { status: 201 });
}
