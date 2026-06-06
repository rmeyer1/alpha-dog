"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  PersonaConfig,
  PersonaId,
  SavedPreset,
  Warning,
  WheelAnalysisResponse,
  WheelCompanyScore,
  WheelFilters,
  WheelScreenerResponse,
} from "@/lib/wheel/types";
import { CandidateResults } from "./wheel-dashboard/candidate-results";
import { CompanyResults } from "./wheel-dashboard/company-results";
import { CompanyScreenerOverview } from "./wheel-dashboard/company-screener-overview";
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

interface LoadCompanyScreenerOptions {
  forceRefresh?: boolean;
  nextFilters: WheelFilters;
  nextPersonaId: PersonaId;
}

const defaultTicker = "";
const topCompanyLimit = 50;
const screenerBatchSize = 8;
const screenerBatchDelayMs = 150;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function warningKey(warning: Warning) {
  return `${warning.type}:${warning.severity}:${warning.message}`;
}

function mergeWarnings(current: Warning[], incoming: Warning[]) {
  const warnings = [...current];
  const seen = new Set(current.map(warningKey));

  for (const warning of incoming) {
    const key = warningKey(warning);

    if (!seen.has(key)) {
      seen.add(key);
      warnings.push(warning);
    }
  }

  return warnings;
}

function rankCompanyScores(
  current: WheelCompanyScore[],
  incoming: WheelCompanyScore[],
) {
  const byTicker = new Map<string, WheelCompanyScore>();

  for (const company of [...current, ...incoming]) {
    const existing = byTicker.get(company.ticker);

    if (!existing || company.score > existing.score) {
      byTicker.set(company.ticker, company);
    }
  }

  return Array.from(byTicker.values())
    .sort((left, right) => right.score - left.score || left.ticker.localeCompare(right.ticker))
    .slice(0, topCompanyLimit)
    .map((company, index) => ({
      ...company,
      rank: index + 1,
    }));
}

export function WheelDashboard({ initialPersonas }: WheelDashboardProps) {
  const defaultPersona = initialPersonas.find((persona) => persona.default) ??
    initialPersonas[0];
  const [ticker, setTicker] = useState(defaultTicker);
  const [personaId, setPersonaId] = useState<PersonaId>(defaultPersona.id);
  const [filters, setFilters] = useState<WheelFilters>(defaultPersona.filters);
  const [activeTab, setActiveTab] = useState<StrategyTab>("puts");
  const [response, setResponse] = useState<WheelAnalysisResponse | null>(null);
  const [screenerResponse, setScreenerResponse] =
    useState<WheelScreenerResponse | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("Balanced 21-30 DTE");
  const screenerRunRef = useRef(0);
  const activePersona = useMemo(
    () => personaById(initialPersonas, personaId, defaultPersona),
    [defaultPersona, initialPersonas, personaId],
  );

  async function loadPresets() {
    const presetResponse = await fetch("/api/presets", { cache: "no-store" });
    const payload = (await presetResponse.json()) as { presets: SavedPreset[] };
    setPresets(payload.presets);
  }

  const runCompanyScreener = useCallback(async function runCompanyScreener({
    forceRefresh = false,
    nextFilters,
    nextPersonaId,
  }: LoadCompanyScreenerOptions) {
    const runId = screenerRunRef.current + 1;
    screenerRunRef.current = runId;
    let cursor = 0;
    let aggregateCompanies: WheelCompanyScore[] = [];
    let aggregateWarnings: Warning[] = [];
    let aggregateErrors: string[] = [];
    let aggregateSkippedCount = 0;

    setRequestState("loading");
    setError(null);
    setResponse(null);
    setScreenerResponse(null);

    try {
      while (true) {
        const apiResponse = await fetch("/api/wheel/screener", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            persona: nextPersonaId,
            filters: nextFilters,
            limit: topCompanyLimit,
            forceRefresh,
            cursor,
            batchSize: screenerBatchSize,
          }),
        });
        const payload = (await apiResponse.json()) as
          | WheelScreenerResponse
          | { error: { message: string } };

        if (!apiResponse.ok || "error" in payload) {
          throw new Error(
            "error" in payload ? payload.error.message : "Analysis failed.",
          );
        }

        if (screenerRunRef.current !== runId) {
          return;
        }

        if (payload.progress.resultScope === "complete") {
          setScreenerResponse(payload);
          setRequestState(
            payload.dataFreshness.cacheStatus === "stale"
              ? "successStale"
              : "successFresh",
          );

          return;
        }

        aggregateCompanies = rankCompanyScores(
          aggregateCompanies,
          payload.companies,
        );
        aggregateWarnings = mergeWarnings(aggregateWarnings, payload.warnings);
        aggregateErrors = [...aggregateErrors, ...payload.errors].slice(0, 25);
        aggregateSkippedCount += payload.skippedCount;

        const completed = payload.progress.status === "complete";
        const aggregatePayload: WheelScreenerResponse = {
          ...payload,
          companies: aggregateCompanies,
          screenedCount: payload.progress.processedCount,
          skippedCount: aggregateSkippedCount,
          warnings: aggregateWarnings,
          errors:
            completed && aggregateCompanies.length === 0 &&
            aggregateErrors.length === 0
              ? ["No companies produced a matching wheel candidate."]
              : aggregateErrors,
        };

        setScreenerResponse(aggregatePayload);
        setRequestState(
          completed
            ? payload.dataFreshness.cacheStatus === "stale"
              ? "successStale"
              : "successFresh"
            : "loading",
        );

        if (payload.progress.nextCursor == null) {
          return;
        }

        cursor = payload.progress.nextCursor;
        await wait(screenerBatchDelayMs);
      }
    } catch (caught) {
      if (screenerRunRef.current !== runId) {
        return;
      }

      setRequestState("errorNoCache");
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    }
  }, []);

  async function analyzeTicker({
    forceRefresh = false,
    nextFilters = filters,
    nextPersonaId = personaId,
    nextTicker = ticker,
  }: {
    forceRefresh?: boolean;
    nextFilters?: WheelFilters;
    nextPersonaId?: PersonaId;
    nextTicker?: string;
  } = {}) {
    const symbol = nextTicker.trim().toUpperCase();

    if (!symbol) {
      await runCompanyScreener({
        forceRefresh,
        nextFilters,
        nextPersonaId,
      });

      return;
    }

    screenerRunRef.current += 1;
    setRequestState(response ? "refreshing" : "loading");
    setError(null);

    try {
      const apiResponse = await fetch("/api/wheel/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticker: symbol,
          persona: nextPersonaId,
          filters: nextFilters,
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

      setTicker(payload.ticker);
      setScreenerResponse(null);
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
    const nextFilters = mergePresetFilters(initialPersonas, preset, defaultPersona);

    setPersonaId(preset.basePersona);
    setFilters(nextFilters);
    setTicker(defaultTicker);
    setResponse(null);
    setPresetName(preset.name);
    void runCompanyScreener({
      nextFilters,
      nextPersonaId: preset.basePersona,
    });
  }

  function selectPersona(nextPersonaId: PersonaId) {
    const nextPersona = personaById(initialPersonas, nextPersonaId, defaultPersona);

    setPersonaId(nextPersona.id);
    setFilters(nextPersona.filters);
    setTicker(defaultTicker);
    setResponse(null);
    void runCompanyScreener({
      nextFilters: nextPersona.filters,
      nextPersonaId: nextPersona.id,
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void analyzeTicker();
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        const presetResponse = await fetch("/api/presets", {
          cache: "no-store",
        });
        const presetPayload = (await presetResponse.json()) as {
          presets: SavedPreset[];
        };

        if (cancelled) {
          return;
        }

        setPresets(presetPayload.presets);
        void runCompanyScreener({
          nextFilters: defaultPersona.filters,
          nextPersonaId: defaultPersona.id,
        });
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
      screenerRunRef.current += 1;
    };
  }, [defaultPersona.filters, defaultPersona.id, runCompanyScreener]);

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
        onForceRefresh={() => {
          if (response || ticker.trim()) {
            void analyzeTicker({ forceRefresh: true });
          } else {
            void runCompanyScreener({
              forceRefresh: true,
              nextFilters: filters,
              nextPersonaId: personaId,
            });
          }
        }}
        onPersonaChange={selectPersona}
        onTickerChange={setTicker}
        personaId={personaId}
        requestState={requestState}
        ticker={ticker}
      />

      <div className="mx-auto grid max-w-[1600px] items-start gap-4 px-4 py-5 md:px-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:px-8">
        <section className="grid min-w-0 content-start gap-4">
          {response ? (
            <>
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
            </>
          ) : (
            <>
              <CompanyScreenerOverview
                activePersona={activePersona}
                error={error}
                filters={filters}
                requestState={requestState}
                response={screenerResponse}
              />

              <CompanyResults
                companies={screenerResponse?.companies ?? []}
                onSelectTicker={(selectedTicker) =>
                  void analyzeTicker({ nextTicker: selectedTicker })
                }
                requestState={requestState}
              />
            </>
          )}
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
