"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  PersonaConfig,
  PersonaId,
  SavedPreset,
  WheelAnalysisResponse,
  WheelFilters,
} from "@/lib/wheel/types";
import { CandidateResults } from "./wheel-dashboard/candidate-results";
import { DashboardHeader } from "./wheel-dashboard/dashboard-header";
import { FilterPanel } from "./wheel-dashboard/filter-panel";
import { MarketOverview } from "./wheel-dashboard/market-overview";
import {
  mergePresetFilters,
  personaById,
} from "./wheel-dashboard/persona-utils";
import { PresetsPanel } from "./wheel-dashboard/presets-panel";
import type { RequestState, StrategyTab } from "./wheel-dashboard/types";

interface WheelDashboardProps {
  initialPersonas: PersonaConfig[];
}

const defaultTicker = "AAPL";

export function WheelDashboard({ initialPersonas }: WheelDashboardProps) {
  const defaultPersona = initialPersonas.find((persona) => persona.default) ??
    initialPersonas[0];
  const [ticker, setTicker] = useState(defaultTicker);
  const [personaId, setPersonaId] = useState<PersonaId>(defaultPersona.id);
  const [filters, setFilters] = useState<WheelFilters>(defaultPersona.filters);
  const [activeTab, setActiveTab] = useState<StrategyTab>("puts");
  const [response, setResponse] = useState<WheelAnalysisResponse | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("Balanced 21-30 DTE");
  const activePersona = useMemo(
    () => personaById(initialPersonas, personaId, defaultPersona),
    [defaultPersona, initialPersonas, personaId],
  );

  async function loadPresets() {
    const presetResponse = await fetch("/api/presets", { cache: "no-store" });
    const payload = (await presetResponse.json()) as { presets: SavedPreset[] };
    setPresets(payload.presets);
  }

  async function analyze(forceRefresh = false) {
    setRequestState(response ? "refreshing" : "loading");
    setError(null);

    try {
      const apiResponse = await fetch("/api/wheel/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticker,
          persona: personaId,
          filters,
          resultLimit: 25,
          forceRefresh,
        }),
      });
      const payload = (await apiResponse.json()) as
        | WheelAnalysisResponse
        | { error: { message: string } };

      if (!apiResponse.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error.message : "Analysis failed.",
        );
      }

      setResponse(payload);
      setRequestState(
        payload.dataFreshness.cacheStatus === "stale"
          ? "successStale"
          : "successFresh",
      );
    } catch (caught) {
      setRequestState("errorNoCache");
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    }
  }

  async function savePreset() {
    const apiResponse = await fetch("/api/presets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: presetName,
        basePersona: personaId,
        filters,
      }),
    });

    if (apiResponse.ok) {
      await loadPresets();
    }
  }

  async function deletePreset(id: string) {
    await fetch(`/api/presets/${id}`, { method: "DELETE" });
    await loadPresets();
  }

  function loadPreset(preset: SavedPreset) {
    setPersonaId(preset.basePersona);
    setFilters(mergePresetFilters(initialPersonas, preset, defaultPersona));
    setPresetName(preset.name);
  }

  function selectPersona(nextPersonaId: PersonaId) {
    const nextPersona = personaById(initialPersonas, nextPersonaId, defaultPersona);

    setPersonaId(nextPersona.id);
    setFilters(nextPersona.filters);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void analyze(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const [presetResponse, analysisResponse] = await Promise.all([
          fetch("/api/presets", { cache: "no-store" }),
          fetch("/api/wheel/analyze", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ticker: defaultTicker,
              persona: defaultPersona.id,
              filters: defaultPersona.filters,
              resultLimit: 25,
              forceRefresh: false,
            }),
          }),
        ]);
        const presetPayload = (await presetResponse.json()) as {
          presets: SavedPreset[];
        };
        const analysisPayload =
          (await analysisResponse.json()) as WheelAnalysisResponse;

        if (cancelled) {
          return;
        }

        setPresets(presetPayload.presets);
        setResponse(analysisPayload);
        setRequestState(
          analysisPayload.dataFreshness.cacheStatus === "stale"
            ? "successStale"
            : "successFresh",
        );
      } catch (caught) {
        if (!cancelled) {
          setRequestState("errorNoCache");
          setError(caught instanceof Error ? caught.message : "Analysis failed.");
        }
      }
    }

    void loadInitialData();

    return () => {
      cancelled = true;
    };
  }, [defaultPersona.filters, defaultPersona.id]);

  const rows = activeTab === "puts"
    ? response?.shortPuts ?? []
    : activeTab === "calls"
      ? response?.coveredCalls ?? []
      : [];
  const spreadRows = activeTab === "putSpreads"
    ? response?.putCreditSpreads ?? []
    : activeTab === "callSpreads"
      ? response?.callCreditSpreads ?? []
      : [];

  return (
    <main className="min-h-screen bg-[#0b0c0d] text-zinc-100">
      <DashboardHeader
        initialPersonas={initialPersonas}
        onAnalyze={handleSubmit}
        onForceRefresh={() => void analyze(true)}
        onPersonaChange={selectPersona}
        onTickerChange={setTicker}
        personaId={personaId}
        requestState={requestState}
        ticker={ticker}
      />

      <div className="mx-auto grid max-w-[1600px] items-start gap-4 px-4 py-5 md:px-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:px-8">
        <section className="grid min-w-0 content-start gap-4">
          <MarketOverview
            activePersona={activePersona}
            error={error}
            filters={filters}
            requestState={requestState}
            response={response}
            ticker={ticker}
          />

          <CandidateResults
            activeTab={activeTab}
            onTabChange={setActiveTab}
            requestState={requestState}
            rows={rows}
            spreadRows={spreadRows}
            underlyingPrice={response?.underlying.price}
          />
        </section>

        <aside className="grid content-start gap-4">
          <FilterPanel
            filters={filters}
            onChange={setFilters}
            onReset={() => setFilters(activePersona.filters)}
          />

          <PresetsPanel
            defaultPersona={defaultPersona}
            initialPersonas={initialPersonas}
            onDelete={(id) => void deletePreset(id)}
            onLoad={loadPreset}
            onNameChange={setPresetName}
            onSave={() => void savePreset()}
            presetName={presetName}
            presets={presets}
          />

          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <h2 className="text-sm font-semibold text-white">Alpaca Setup</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Add keys to `.env.local`, set `USE_DEMO_DATA=false`, then call
              `/api/alpaca/feed-test?ticker=AAPL` to compare OPRA and
              indicative access.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
