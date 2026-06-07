"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  PersonaConfig,
  PersonaId,
  SavedPreset,
  WheelAnalysisResponse,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerResponse,
  WheelScreenerRunResponse,
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
  nextStrategy: WheelCompanyStrategy;
}

const defaultTicker = "";
const topCompanyLimit = 50;
const screenerPollDelayMs = 1500;
const screenerRunStoragePrefix = "alpha-dog:wheel-screener-run:";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, entryValue]) =>
      `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function screenerRunStorageKey({
  filters,
  personaId,
  strategy,
}: {
  filters: WheelFilters;
  personaId: PersonaId;
  strategy: WheelCompanyStrategy;
}) {
  return `${screenerRunStoragePrefix}${personaId}:${strategy}:${stableStringify(filters)}`;
}

function strategyToTab(strategy: WheelCompanyStrategy): StrategyTab {
  switch (strategy) {
    case "short_put":
      return "puts";
    case "put_credit_spread":
      return "putSpreads";
    case "covered_call":
      return "calls";
    case "call_credit_spread":
      return "callSpreads";
  }
}

export function WheelDashboard({ initialPersonas }: WheelDashboardProps) {
  const defaultPersona = initialPersonas.find((persona) => persona.default) ??
    initialPersonas[0];
  const [ticker, setTicker] = useState(defaultTicker);
  const [personaId, setPersonaId] = useState<PersonaId>(defaultPersona.id);
  const [filters, setFilters] = useState<WheelFilters>(defaultPersona.filters);
  const [activeTab, setActiveTab] = useState<StrategyTab>("puts");
  const [activeScreenerStrategy, setActiveScreenerStrategy] =
    useState<WheelCompanyStrategy>("short_put");
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

  const loadScreenerRun = useCallback(async function loadScreenerRun(
    runId: string,
  ) {
    const apiResponse = await fetch(`/api/wheel/screener/runs/${runId}`, {
      cache: "no-store",
    });
    const payload = (await apiResponse.json()) as
      | WheelScreenerRunResponse
      | { error: { message: string } };

    if (!apiResponse.ok || "error" in payload) {
      throw new Error(
        "error" in payload ? payload.error.message : "Analysis failed.",
      );
    }

    return payload;
  }, []);

  const consumeScreenerStream = useCallback(async function consumeScreenerStream({
    runId,
    runNumber,
    signal,
  }: {
    runId: string;
    runNumber: number;
    signal: AbortSignal;
  }) {
    try {
      const apiResponse = await fetch(
        `/api/wheel/screener/runs/${runId}/stream?startIndex=-1`,
        {
          cache: "no-store",
          signal,
        },
      );

      if (!apiResponse.ok || !apiResponse.body) {
        return;
      }

      const reader = apiResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();

          if (!trimmed || screenerRunRef.current !== runNumber) {
            continue;
          }

          const snapshot = JSON.parse(trimmed) as WheelScreenerResponse;

          setScreenerResponse(snapshot);
          setRequestState(
            snapshot.progress.status === "complete"
              ? snapshot.dataFreshness.cacheStatus === "stale"
                ? "successStale"
                : "successFresh"
              : "loading",
          );
        }
      }
    } catch (caught) {
      if (!signal.aborted) {
        console.warn("Unable to stream screener progress.", caught);
      }
    }
  }, []);

  const runCompanyScreener = useCallback(async function runCompanyScreener({
    forceRefresh = false,
    nextFilters,
    nextPersonaId,
    nextStrategy,
  }: LoadCompanyScreenerOptions) {
    const runNumber = screenerRunRef.current + 1;
    const storageKey = screenerRunStorageKey({
      filters: nextFilters,
      personaId: nextPersonaId,
      strategy: nextStrategy,
    });
    let workflowRunId = forceRefresh
      ? null
      : window.localStorage.getItem(storageKey);
    let streamController: AbortController | null = null;

    screenerRunRef.current = runNumber;

    setRequestState("loading");
    setError(null);
    setResponse(null);
    setScreenerResponse(null);

    try {
      if (workflowRunId) {
        try {
          const attachedRun = await loadScreenerRun(workflowRunId);

          if (screenerRunRef.current !== runNumber) {
            return;
          }

          if (attachedRun.status === "completed" && attachedRun.result) {
            setScreenerResponse(attachedRun.result);
            setRequestState(
              attachedRun.result.dataFreshness.cacheStatus === "stale"
                ? "successStale"
                : "successFresh",
            );

            return;
          }

          if (
            attachedRun.status === "failed" ||
            attachedRun.status === "cancelled"
          ) {
            window.localStorage.removeItem(storageKey);
            workflowRunId = null;
          }
        } catch {
          window.localStorage.removeItem(storageKey);
          workflowRunId = null;
        }
      }

      if (!workflowRunId) {
        const apiResponse = await fetch("/api/wheel/screener/runs", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            persona: nextPersonaId,
            strategy: nextStrategy,
            filters: nextFilters,
            limit: topCompanyLimit,
            forceRefresh,
          }),
        });
        const payload = (await apiResponse.json()) as
          | WheelScreenerRunResponse
          | { error: { message: string } };

        if (!apiResponse.ok || "error" in payload) {
          throw new Error(
            "error" in payload ? payload.error.message : "Analysis failed.",
          );
        }

        if (payload.status === "completed" && payload.result) {
          setScreenerResponse(payload.result);
          setRequestState(
            payload.result.dataFreshness.cacheStatus === "stale"
              ? "successStale"
              : "successFresh",
          );

          return;
        }

        workflowRunId = payload.runId;
        window.localStorage.setItem(storageKey, workflowRunId);
      }

      streamController = new AbortController();
      void consumeScreenerStream({
        runId: workflowRunId,
        runNumber,
        signal: streamController.signal,
      });

      while (true) {
        const run = await loadScreenerRun(workflowRunId);

        if (screenerRunRef.current !== runNumber) {
          return;
        }

        if (run.status === "completed" && run.result) {
          streamController.abort();
          setScreenerResponse(run.result);
          setRequestState(
            run.result.dataFreshness.cacheStatus === "stale"
              ? "successStale"
              : "successFresh",
          );

          return;
        }

        if (run.status === "failed" || run.status === "cancelled") {
          window.localStorage.removeItem(storageKey);
          throw new Error(`Screener workflow ${run.status}.`);
        }

        await wait(screenerPollDelayMs);
      }
    } catch (caught) {
      streamController?.abort();

      if (screenerRunRef.current !== runNumber) {
        return;
      }

      setRequestState("errorNoCache");
      setError(caught instanceof Error ? caught.message : "Analysis failed.");
    }
  }, [consumeScreenerStream, loadScreenerRun]);

  async function analyzeTicker({
    forceRefresh = false,
    nextActiveTab = activeTab,
    nextFilters = filters,
    nextPersonaId = personaId,
    nextTicker = ticker,
  }: {
    forceRefresh?: boolean;
    nextActiveTab?: StrategyTab;
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
        nextStrategy: activeScreenerStrategy,
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
      setActiveTab(nextActiveTab);
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
      nextStrategy: activeScreenerStrategy,
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
      nextStrategy: activeScreenerStrategy,
    });
  }

  function selectScreenerStrategy(nextStrategy: WheelCompanyStrategy) {
    setActiveScreenerStrategy(nextStrategy);
    setTicker(defaultTicker);
    setResponse(null);
    setActiveTab(strategyToTab(nextStrategy));
    void runCompanyScreener({
      nextFilters: filters,
      nextPersonaId: personaId,
      nextStrategy,
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
          nextStrategy: "short_put",
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
              nextStrategy: activeScreenerStrategy,
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
                strategy={activeScreenerStrategy}
              />

              <CompanyResults
                activeStrategy={activeScreenerStrategy}
                companies={screenerResponse?.companies ?? []}
                onSelectStrategy={selectScreenerStrategy}
                onSelectTicker={(selectedTicker, strategy) =>
                  void analyzeTicker({
                    nextActiveTab: strategyToTab(strategy),
                    nextTicker: selectedTicker,
                  })
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
