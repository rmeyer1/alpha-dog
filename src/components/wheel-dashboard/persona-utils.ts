import type {
  PersonaConfig,
  PersonaId,
  SavedPreset,
} from "@/lib/wheel/types";

export function personaById(
  personas: PersonaConfig[],
  personaId: PersonaId,
  fallback: PersonaConfig,
) {
  return personas.find((persona) => persona.id === personaId) ?? fallback;
}

export function mergePresetFilters(
  personas: PersonaConfig[],
  preset: SavedPreset,
  fallback: PersonaConfig,
) {
  return {
    ...personaById(personas, preset.basePersona, fallback).filters,
    ...preset.filters,
  };
}
