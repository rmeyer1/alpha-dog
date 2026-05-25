import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SavedPreset } from "@/lib/wheel/types";
import type { z } from "zod";
import type { savedPresetInputSchema } from "@/lib/wheel/validation";

const storePath = path.join(process.cwd(), ".data", "presets.json");

async function ensureStoreDir() {
  await mkdir(path.dirname(storePath), { recursive: true });
}

async function readPresets(): Promise<SavedPreset[]> {
  try {
    const contents = await readFile(storePath, "utf8");

    return JSON.parse(contents) as SavedPreset[];
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }

    throw error;
  }
}

async function writePresets(presets: SavedPreset[]) {
  await ensureStoreDir();
  await writeFile(storePath, JSON.stringify(presets, null, 2));
}

export async function listSavedPresets() {
  return readPresets();
}

export async function createSavedPreset(
  input: z.infer<typeof savedPresetInputSchema>,
) {
  const now = new Date().toISOString();
  const presets = await readPresets();
  const preset: SavedPreset = {
    id: randomUUID(),
    name: input.name,
    basePersona: input.basePersona,
    filters: input.filters,
    createdAt: now,
    updatedAt: now,
  };

  await writePresets([...presets, preset]);

  return preset;
}

export async function updateSavedPreset(
  id: string,
  input: z.infer<typeof savedPresetInputSchema>,
) {
  const presets = await readPresets();
  const index = presets.findIndex((preset) => preset.id === id);

  if (index === -1) {
    return null;
  }

  const updated: SavedPreset = {
    ...presets[index],
    name: input.name,
    basePersona: input.basePersona,
    filters: input.filters,
    updatedAt: new Date().toISOString(),
  };
  presets[index] = updated;
  await writePresets(presets);

  return updated;
}

export async function deleteSavedPreset(id: string) {
  const presets = await readPresets();
  const nextPresets = presets.filter((preset) => preset.id !== id);

  if (nextPresets.length === presets.length) {
    return false;
  }

  await writePresets(nextPresets);

  return true;
}
