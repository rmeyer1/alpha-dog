import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import type { savedPresetInputSchema } from "@/lib/wheel/validation";
import type { SavedPreset } from "@/lib/wheel/types";

interface SavedPresetRow {
  base_persona_id: SavedPreset["basePersona"];
  created_at: string;
  filters: SavedPreset["filters"];
  id: string;
  name: string;
  updated_at: string;
  user_id: string;
}

function toSavedPreset(row: SavedPresetRow): SavedPreset {
  return {
    basePersona: row.base_persona_id,
    createdAt: row.created_at,
    filters: row.filters ?? {},
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
  };
}

const presetColumns = [
  "id",
  "user_id",
  "name",
  "base_persona_id",
  "filters",
  "created_at",
  "updated_at",
].join(",");

export async function listSavedPresets(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("saved_presets")
    .select(presetColumns)
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error("Unable to load saved presets.");
  }

  return (data as unknown as SavedPresetRow[]).map(toSavedPreset);
}

export async function createSavedPreset(
  supabase: SupabaseClient,
  userId: string,
  input: z.infer<typeof savedPresetInputSchema>,
) {
  const { data, error } = await supabase
    .from("saved_presets")
    .insert({
      base_persona_id: input.basePersona,
      filters: input.filters,
      name: input.name,
      user_id: userId,
    })
    .select(presetColumns)
    .single();

  if (error) {
    throw new Error("Unable to create saved preset.");
  }

  return toSavedPreset(data as unknown as SavedPresetRow);
}

export async function updateSavedPreset(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  input: z.infer<typeof savedPresetInputSchema>,
) {
  const { data, error } = await supabase
    .from("saved_presets")
    .update({
      base_persona_id: input.basePersona,
      filters: input.filters,
      name: input.name,
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select(presetColumns)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to update saved preset.");
  }

  return data ? toSavedPreset(data as unknown as SavedPresetRow) : null;
}

export async function deleteSavedPreset(
  supabase: SupabaseClient,
  userId: string,
  id: string,
) {
  const { data, error } = await supabase
    .from("saved_presets")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new Error("Unable to delete saved preset.");
  }

  return Boolean(data);
}

export async function getSavedPresetOwner(
  supabase: SupabaseClient,
  id: string,
) {
  const { data, error } = await supabase
    .from("saved_presets")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error("Unable to inspect saved preset ownership.");
  }

  return (data as { user_id: string } | null)?.user_id ?? null;
}
