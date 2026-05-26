import { Save, Trash2 } from "lucide-react";
import type {
  PersonaConfig,
  SavedPreset,
} from "@/lib/wheel/types";
import { formatPercent } from "./formatters";
import { mergePresetFilters } from "./persona-utils";

function PresetSummary({
  preset,
  personas,
  fallback,
}: {
  preset: SavedPreset;
  personas: PersonaConfig[];
  fallback: PersonaConfig;
}) {
  const presetFilters = mergePresetFilters(personas, preset, fallback);

  return (
    <div className="text-xs text-zinc-500">
      DTE {presetFilters.dteMin}-{presetFilters.dteMax}
      {" · "}
      Delta {presetFilters.deltaMin}-{presetFilters.deltaMax}
      {" · "}
      Min {formatPercent(presetFilters.minPremiumYield)}
    </div>
  );
}

export function PresetsPanel({
  defaultPersona,
  initialPersonas,
  onDelete,
  onLoad,
  onNameChange,
  onSave,
  presetName,
  presets,
}: {
  defaultPersona: PersonaConfig;
  initialPersonas: PersonaConfig[];
  onDelete: (id: string) => void;
  onLoad: (preset: SavedPreset) => void;
  onNameChange: (name: string) => void;
  onSave: () => void;
  presetName: string;
  presets: SavedPreset[];
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <h2 className="text-sm font-semibold text-white">Saved Presets</h2>
      <div className="mt-4 grid gap-3">
        <label className="grid gap-1.5 text-sm">
          <span className="text-zinc-400">Preset name</span>
          <input
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
            onChange={(event) => onNameChange(event.target.value)}
            value={presetName}
          />
        </label>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-semibold text-white transition hover:bg-white/[0.08]"
          onClick={onSave}
          type="button"
        >
          <Save className="size-4" />
          Save Current Filters
        </button>
      </div>
      <div className="mt-5 grid gap-2">
        {presets.length === 0 ? (
          <p className="text-sm text-zinc-500">No saved presets yet.</p>
        ) : (
          presets.map((preset) => (
            <div
              className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-white/10 bg-black/20 p-3"
              key={preset.id}
            >
              <button
                className="text-left"
                onClick={() => onLoad(preset)}
                type="button"
              >
                <div className="text-sm font-medium text-white">
                  {preset.name}
                </div>
                <PresetSummary
                  fallback={defaultPersona}
                  personas={initialPersonas}
                  preset={preset}
                />
              </button>
              <button
                aria-label={`Delete ${preset.name}`}
                className="flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-red-200"
                onClick={() => onDelete(preset.id)}
                type="button"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
