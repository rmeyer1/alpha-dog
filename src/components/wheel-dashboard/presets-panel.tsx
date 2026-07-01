import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
  Trash2,
  UserCircle,
} from "lucide-react";
import type { PresetAccessState } from "@/lib/presets/ui";
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
      {" · "}
      Width ${presetFilters.maxSpreadWidth}
    </div>
  );
}

export function PresetsPanel({
  accessState,
  defaultPersona,
  deletingPresetId,
  feedback,
  initialPersonas,
  onDelete,
  onLoad,
  onNameChange,
  onRetry,
  onSave,
  operation,
  presetName,
  presets,
  signInHref,
}: {
  accessState: PresetAccessState;
  defaultPersona: PersonaConfig;
  deletingPresetId: string | null;
  feedback: { message: string; tone: "error" | "success" } | null;
  initialPersonas: PersonaConfig[];
  onDelete: (id: string) => void;
  onLoad: (preset: SavedPreset) => void;
  onNameChange: (name: string) => void;
  onRetry: () => void;
  onSave: () => void;
  operation: "deleting" | "idle" | "loading" | "saving";
  presetName: string;
  presets: SavedPreset[];
  signInHref: string;
}) {
  const isReady = accessState.status === "ready";
  const isSaving = operation === "saving";
  const isLoading = accessState.status === "loading" || operation === "loading";

  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-white">Saved Presets</h2>
        {isLoading ? (
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <Loader2 className="size-3.5 animate-spin" />
            Loading
          </span>
        ) : null}
      </div>

      {accessState.status === "unauthenticated" ||
      accessState.status === "profile_incomplete" ? (
        <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-300/10 p-4">
          <div className="flex items-start gap-3">
            <UserCircle className="mt-0.5 size-5 shrink-0 text-amber-200" />
            <div>
              <p className="text-sm font-medium text-white">
                {accessState.status === "unauthenticated"
                  ? "Sign in to save presets"
                  : "Complete profile to save presets"}
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                {accessState.message}
              </p>
              <Link
                className="mt-3 inline-flex min-h-10 items-center justify-center rounded-lg bg-emerald-300 px-3 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
                href={signInHref}
              >
                {accessState.status === "unauthenticated"
                  ? "Sign in"
                  : "Complete profile"}
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {accessState.status === "error" ? (
        <div className="mt-4 rounded-lg border border-red-300/25 bg-red-300/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-200" />
            <div>
              <p className="text-sm font-medium text-white">
                Presets unavailable
              </p>
              <p className="mt-2 text-sm leading-6 text-zinc-300">
                {accessState.message}
              </p>
              <button
                className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
                onClick={onRetry}
                type="button"
              >
                <RefreshCw className="size-4" />
                Retry
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {isReady ? (
        <>
          <div className="mt-4 grid gap-3">
            <label className="grid gap-1.5 text-sm" htmlFor="presetName">
              <span className="text-zinc-400">Preset name</span>
              <input
                className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none transition focus:border-emerald-300/70"
                disabled={isSaving}
                id="presetName"
                onChange={(event) => onNameChange(event.target.value)}
                value={presetName}
              />
            </label>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSaving}
              onClick={onSave}
              type="button"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {isSaving ? "Saving preset" : "Save Current Filters"}
            </button>
          </div>

          {feedback ? (
            <p
              aria-live="polite"
              className={`mt-4 rounded-lg border p-3 text-sm ${
                feedback.tone === "success"
                  ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                  : "border-red-300/25 bg-red-300/10 text-red-100"
              }`}
            >
              {feedback.tone === "success" ? (
                <CheckCircle2 className="mr-2 inline size-4" />
              ) : (
                <AlertTriangle className="mr-2 inline size-4" />
              )}
              {feedback.message}
            </p>
          ) : null}

          <div className="mt-5 grid gap-2">
            {presets.length === 0 ? (
              <p className="text-sm text-zinc-500">No saved presets yet.</p>
            ) : (
              presets.map((preset) => {
                const isDeleting = operation === "deleting" &&
                  deletingPresetId === preset.id;

                return (
                  <div
                    className="grid grid-cols-[1fr_auto] gap-2 rounded-lg border border-white/10 bg-black/20 p-3"
                    key={preset.id}
                  >
                    <button
                      className="text-left focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
                      disabled={isDeleting}
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
                      className="flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={operation !== "idle"}
                      onClick={() => onDelete(preset.id)}
                      type="button"
                    >
                      {isDeleting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Trash2 className="size-4" />
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
