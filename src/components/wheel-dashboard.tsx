"use client";

import {
  AlertTriangle,
  Database,
  ListChecks,
  ShieldAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type {
  PersonaConfig,
  PersonaId,
  SavedPreset,
  WheelCompanyStrategy,
  WheelAnalysisResponse,
  WheelFilters,
  WheelScreenerResponse,
  WheelScreenerRunResponse,
} from "@/lib/wheel/types";
import type { JsonValue } from "@/lib/trade-analysis/types";
import {
  isPresetAccessError,
  presetAccessStateFromApiError,
  presetOperationErrorMessage,
  type PresetAccessState,
} from "@/lib/presets/ui";
import { CandidateResults } from "./wheel-dashboard/candidate-results";
import { CompanyInsightStrip } from "@/components/company-insights";
import { CompanyResults } from "./wheel-dashboard/company-results";
import { CompanyScreenerOverview } from "./wheel-dashboard/company-screener-overview";
import { shouldAutoRefreshScreenerResponse } from "@/lib/wheel/screener-auto-refresh";
import { DashboardHeader } from "./wheel-dashboard/dashboard-header";
import { FilterPanel } from "./wheel-dashboard/filter-panel";
import {
  FreshnessStatusPill,
  getFreshnessView,
} from "./wheel-dashboard/freshness-status";
import { MarketOverview } from "./wheel-dashboard/market-overview";
import {
  mergePresetFilters,
  personaById,
} from "./wheel-dashboard/persona-utils";
import { PresetsPanel } from "./wheel-dashboard/presets-panel";
import type { RequestState, StrategyTab } from "./wheel-dashboard/types";
import { useCompanyInsights } from "./wheel-dashboard/use-company-insights";

interface WheelDashboardProps {
  initialPersonas: PersonaConfig[];
}

const defaultTicker = "";
const defaultScreenerStrategy: WheelCompanyStrategy = "short_put";

type ApiErrorPayload = {
  error: {
    code?: string;
    message: string;
  };
};

type PresetOperation = "deleting" | "idle" | "loading" | "saving";

type PresetFeedback = {
  message: string;
  tone: "error" | "success";
};

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}

function isScreenerRunResponse(
  payload: WheelScreenerResponse | WheelScreenerRunResponse,
): payload is WheelScreenerRunResponse {
  return "runId" in payload;
}

function tabForStrategy(strategy: WheelCompanyStrategy): StrategyTab {
  switch (strategy) {
    case "covered_call":
      return "calls";
    case "put_credit_spread":
      return "putSpreads";
    case "call_credit_spread":
      return "callSpreads";
    case "short_put":
      return "puts";
  }
}

function ScreenerStatusStrip({
  activePersona,
  error,
  response,
  screenerResponse,
  requestState,
}: {
  activePersona: PersonaConfig;
  error: string | null;
  response: WheelAnalysisResponse | null;
  screenerResponse: WheelScreenerResponse | null;
  requestState: RequestState;
}) {
  const freshness = response?.dataFreshness ?? screenerResponse?.dataFreshness;
  const warningCount = response
    ? response.warnings.length
    : screenerResponse?.warnings.length ?? 0;
  const rankedCount = response
    ? response.shortPuts.length +
      response.coveredCalls.length +
      response.putCreditSpreads.length +
      response.callCreditSpreads.length
    : screenerResponse?.companies.length ?? 0;
  const feed = freshness?.feed.toUpperCase() ?? "Pending";
  const freshnessView = getFreshnessView(freshness, requestState);

  const tiles = [
    {
      label: "Feed",
      value: feed,
      icon: Database,
      tone: "text-cyan-200",
    },
    {
      label: "Freshness",
      value: <FreshnessStatusPill className="w-full" view={freshnessView} />,
      icon: freshnessView.icon,
      tone: freshnessView.tone.icon,
    },
    {
      label: "Ranked",
      value: `${rankedCount} candidates`,
      icon: ListChecks,
      tone: "text-zinc-200",
    },
    {
      label: "Risk flags",
      value: error ? "Action needed" : warningCount ? `${warningCount} warning${warningCount === 1 ? "" : "s"}` : "None",
      icon: warningCount || error ? AlertTriangle : ShieldAlert,
      tone: error
        ? "text-red-200"
        : warningCount
          ? "text-amber-200"
          : "text-emerald-200",
    },
  ];

  return (
    <section className="border-b border-white/10 bg-[#0f1112]">
      <div className="mx-auto grid max-w-[1600px] gap-2 px-4 py-3 md:grid-cols-4 md:px-6 xl:px-8">
        {tiles.map((tile) => (
          <div
            className="flex min-h-12 items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3"
            key={tile.label}
          >
            <tile.icon className={`size-4 shrink-0 ${tile.tone}`} />
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
                {tile.label}
              </div>
              <div className="truncate text-sm font-medium text-zinc-100">
                {tile.value}
              </div>
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 md:col-span-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
            Active mandate
          </div>
          <div className="mt-1 text-sm text-zinc-300">
            {activePersona.name}: {activePersona.motto}
          </div>
        </div>
      </div>
    </section>
  );
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
  const [screenerStrategy, setScreenerStrategy] =
    useState<WheelCompanyStrategy>(defaultScreenerStrategy);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetAccessState, setPresetAccessState] =
    useState<PresetAccessState>({
      message: "Loading saved presets.",
      status: "loading",
    });
  const [presetFeedback, setPresetFeedback] = useState<PresetFeedback | null>(
    null,
  );
  const [presetName, setPresetName] = useState("Balanced 21-30 DTE");
  const [presetOperation, setPresetOperation] =
    useState<PresetOperation>("loading");
  const [deletingPresetId, setDeletingPresetId] = useState<string | null>(null);
  const didLoadInitialScreener = useRef(false);
  const didAutoRefreshInitialScreener = useRef(false);
  const activePersona = useMemo(
    () => personaById(initialPersonas, personaId, defaultPersona),
    [defaultPersona, initialPersonas, personaId],
  );

  async function loadPresets({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) {
      setPresetAccessState((current) =>
        current.status === "ready"
          ? current
          : {
              message: "Loading saved presets.",
              status: "loading",
            });
      setPresetOperation("loading");
    }

    try {
      const presetResponse = await fetch("/api/presets", { cache: "no-store" });
      const payload = (await presetResponse.json()) as
        | { presets: SavedPreset[] }
        | ApiErrorPayload;

      if (!presetResponse.ok || isApiErrorPayload(payload)) {
        setPresets([]);
        setPresetAccessState(
          presetAccessStateFromApiError(
            isApiErrorPayload(payload) ? payload : null,
            presetResponse.status,
          ),
        );
        setPresetOperation("idle");

        return false;
      }

      setPresets(payload.presets);
      setPresetAccessState({ status: "ready" });
      setPresetOperation("idle");

      return true;
    } catch {
      setPresets([]);
      setPresetAccessState({
        message: "Unable to load saved presets.",
        status: "error",
      });
      setPresetOperation("idle");

      return false;
    }
  }

  function clearTickerResult() {
    setResponse(null);
    setError(null);
    setRequestState(screenerResponse ? "successFresh" : "idle");
  }

  const pollScreenerRun = useCallback(async (runId: string) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const apiResponse = await fetch(
        `/api/wheel/screener/runs/${encodeURIComponent(runId)}`,
        { cache: "no-store" },
      );
      const payload = (await apiResponse.json()) as
        | WheelScreenerRunResponse
        | ApiErrorPayload;

      if (!apiResponse.ok || isApiErrorPayload(payload)) {
        throw new Error(
          isApiErrorPayload(payload)
            ? payload.error.message
            : "Unable to load screener run.",
        );
      }

      if (payload.status === "completed" && payload.result) {
        return payload.result;
      }

      if (payload.status === "failed" || payload.status === "cancelled") {
        throw new Error("Universe screener run did not complete.");
      }
    }

    throw new Error("Universe screener run is still in progress.");
  }, []);

  const loadTopCompanies = useCallback(
    async ({
      forceRefresh = false,
      nextFilters = filters,
      nextPersonaId = personaId,
      nextStrategy = screenerStrategy,
      showAsRefresh = false,
    }: {
      forceRefresh?: boolean;
      nextFilters?: WheelFilters;
      nextPersonaId?: PersonaId;
      nextStrategy?: WheelCompanyStrategy;
      showAsRefresh?: boolean;
    } = {}) => {
      await Promise.resolve();

      const strategyChanged = nextStrategy !== screenerStrategy;
      const filtersChanged = nextFilters !== filters;

      setRequestState(
        showAsRefresh || screenerResponse ? "refreshing" : "loading",
      );
      setError(null);
      setScreenerStrategy(nextStrategy);

      if (strategyChanged || filtersChanged || nextPersonaId !== personaId) {
        setScreenerResponse(null);
      }

      try {
        const apiResponse = await fetch("/api/wheel/screener", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            persona: nextPersonaId,
            strategy: nextStrategy,
            filters: nextFilters,
            limit: 50,
            forceRefresh,
          }),
        });
        const payload = (await apiResponse.json()) as
          | WheelScreenerResponse
          | WheelScreenerRunResponse
          | ApiErrorPayload;

        if (!apiResponse.ok || isApiErrorPayload(payload)) {
          throw new Error(
            isApiErrorPayload(payload)
              ? payload.error.message
              : "Unable to load top companies.",
          );
        }

        const nextResponse = isScreenerRunResponse(payload)
          ? payload.result ?? await pollScreenerRun(payload.runId)
          : payload;

        setScreenerResponse(nextResponse);
        setRequestState(
          nextResponse.dataFreshness.cacheStatus === "stale"
            ? "successStale"
            : "successFresh",
        );

        return nextResponse;
      } catch (caught) {
        setRequestState("errorNoCache");
        setError(
          caught instanceof Error
            ? caught.message
            : "Unable to load top companies.",
        );

        return null;
      }
    },
    [
      filters,
      personaId,
      pollScreenerRun,
      screenerResponse,
      screenerStrategy,
    ],
  );

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
      clearTickerResult();

      return;
    }

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
          strategy:
            nextActiveTab === "calls"
              ? "covered_call"
              : nextActiveTab === "putSpreads"
                ? "put_credit_spread"
                : nextActiveTab === "callSpreads"
                  ? "call_credit_spread"
                  : "short_put",
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
    if (presetAccessState.status !== "ready") {
      return;
    }

    setPresetFeedback(null);
    setPresetOperation("saving");

    let apiResponse: Response;

    try {
      apiResponse = await fetch("/api/presets", {
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
    } catch {
      setPresetFeedback({
        message: "Unable to save preset.",
        tone: "error",
      });
      setPresetOperation("idle");

      return;
    }

    if (apiResponse.ok) {
      const reloaded = await loadPresets({ silent: true });

      if (reloaded) {
        setPresetFeedback({
          message: "Preset saved.",
          tone: "success",
        });
      }

      setPresetOperation("idle");

      return;
    }

    const payload = (await apiResponse.json().catch(() => null)) as
      | ApiErrorPayload
      | null;
    if (
      payload &&
      isApiErrorPayload(payload) &&
      isPresetAccessError(payload, apiResponse.status)
    ) {
      setPresetAccessState(
        presetAccessStateFromApiError(payload, apiResponse.status),
      );
    }

    setPresetFeedback({
      message: presetOperationErrorMessage(
        payload,
        "Unable to save preset.",
      ),
      tone: "error",
    });
    setPresetOperation("idle");
  }

  async function deletePreset(id: string) {
    if (presetAccessState.status !== "ready") {
      return;
    }

    setDeletingPresetId(id);
    setPresetFeedback(null);
    setPresetOperation("deleting");

    let apiResponse: Response;

    try {
      apiResponse = await fetch(`/api/presets/${id}`, { method: "DELETE" });
    } catch {
      setPresetFeedback({
        message: "Unable to delete preset.",
        tone: "error",
      });
      setPresetOperation("idle");
      setDeletingPresetId(null);

      return;
    }

    if (!apiResponse.ok) {
      const payload = (await apiResponse.json().catch(() => null)) as
        | ApiErrorPayload
        | null;
      if (
        payload &&
        isApiErrorPayload(payload) &&
        isPresetAccessError(payload, apiResponse.status)
      ) {
        setPresetAccessState(
          presetAccessStateFromApiError(payload, apiResponse.status),
        );
      }

      setPresetFeedback({
        message: presetOperationErrorMessage(
          payload,
          "Unable to delete preset.",
        ),
        tone: "error",
      });
      setPresetOperation("idle");
      setDeletingPresetId(null);

      return;
    }

    const reloaded = await loadPresets({ silent: true });

    if (reloaded) {
      setPresetFeedback({
        message: "Preset deleted.",
        tone: "success",
      });
    }

    setPresetOperation("idle");
    setDeletingPresetId(null);
  }

  function loadPreset(preset: SavedPreset) {
    const nextFilters = mergePresetFilters(initialPersonas, preset, defaultPersona);

    setPersonaId(preset.basePersona);
    setFilters(nextFilters);
    setPresetName(preset.name);
    clearTickerResult();

    if (!ticker.trim()) {
      void loadTopCompanies({
        nextFilters,
        nextPersonaId: preset.basePersona,
      });
    }
  }

  function selectPersona(nextPersonaId: PersonaId) {
    const nextPersona = personaById(initialPersonas, nextPersonaId, defaultPersona);

    setPersonaId(nextPersona.id);
    setFilters(nextPersona.filters);
    clearTickerResult();

    if (!ticker.trim()) {
      void loadTopCompanies({
        nextFilters: nextPersona.filters,
        nextPersonaId: nextPersona.id,
      });
    }
  }

  function handleFiltersChange(nextFilters: WheelFilters) {
    setFilters(nextFilters);
    clearTickerResult();

    if (!ticker.trim()) {
      void loadTopCompanies({ nextFilters });
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void analyzeTicker();
  }

  function handleTickerChange(nextTicker: string) {
    setTicker(nextTicker);

    if (!nextTicker.trim()) {
      setResponse(null);

      if (!screenerResponse) {
        void loadTopCompanies();
      }

      return;
    }

    if (
      response &&
      response.ticker !== nextTicker.trim().toUpperCase()
    ) {
      setResponse(null);
      setRequestState("idle");
      setError(null);
    }
  }

  function handleForceRefresh() {
    if (ticker.trim()) {
      void analyzeTicker({ forceRefresh: true });

      return;
    }

    void loadTopCompanies({ forceRefresh: true });
  }

  function handleSelectCompanyTicker(
    nextTicker: string,
    strategy: WheelCompanyStrategy,
  ) {
    const nextActiveTab = tabForStrategy(strategy);

    setTicker(nextTicker);
    void analyzeTicker({
      nextActiveTab,
      nextTicker,
    });
  }

  function handleScreenerStrategyChange(strategy: WheelCompanyStrategy) {
    void loadTopCompanies({ nextStrategy: strategy });
  }

  function handleAccountSignedOut() {
    setPresets([]);
    setPresetAccessState({
      message: "Sign in to use saved presets.",
      status: "unauthenticated",
    });
    setPresetFeedback(null);
    setPresetOperation("idle");
    setDeletingPresetId(null);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialData() {
      try {
        if (!cancelled) {
          await loadPresets();
        }
      } catch (caught) {
        if (!cancelled) {
          setRequestState("errorNoCache");
          setError(caught instanceof Error ? caught.message : "Analysis failed.");
        }
      }
    }

    let screenerLoadTimer: number | null = null;

    if (!didLoadInitialScreener.current) {
      didLoadInitialScreener.current = true;
      screenerLoadTimer = window.setTimeout(() => {
        void (async () => {
          const initialResponse = await loadTopCompanies();

          if (
            !cancelled &&
            shouldAutoRefreshScreenerResponse({
              alreadyRefreshed: didAutoRefreshInitialScreener.current,
              response: initialResponse,
            })
          ) {
            didAutoRefreshInitialScreener.current = true;
            void loadTopCompanies({
              forceRefresh: true,
              showAsRefresh: true,
            });
          }
        })();
      }, 0);
    }

    void loadInitialData();

    return () => {
      cancelled = true;
      if (screenerLoadTimer) {
        window.clearTimeout(screenerLoadTimer);
      }
    };
  }, [loadTopCompanies]);

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
  const hasTicker = ticker.trim().length > 0;
  const companyInsightState = useCompanyInsights(
    hasTicker ? response?.ticker ?? ticker : null,
  );
  const freshness = response?.dataFreshness ?? screenerResponse?.dataFreshness;
  const isServerRefreshRunning =
    freshness?.refreshStatus === "refreshing" || requestState === "refreshing";

  return (
    <main className="min-h-screen bg-[#0b0c0d] text-zinc-100">
      <DashboardHeader
        canAnalyze={hasTicker}
        canRefresh={
          hasTicker
            ? Boolean(response) && !isServerRefreshRunning
            : !isServerRefreshRunning
        }
        initialPersonas={initialPersonas}
        onAccountSignedOut={handleAccountSignedOut}
        onAnalyze={handleSubmit}
        onForceRefresh={handleForceRefresh}
        onPersonaChange={selectPersona}
        onTickerChange={handleTickerChange}
        personaId={personaId}
        requestState={requestState}
        refreshInProgress={isServerRefreshRunning}
        ticker={ticker}
      />
      <ScreenerStatusStrip
        activePersona={activePersona}
        error={error}
        requestState={requestState}
        response={response}
        screenerResponse={screenerResponse}
      />

      <div className="mx-auto grid max-w-[1600px] items-start gap-4 px-4 py-5 md:px-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:px-8">
        <section className="grid min-w-0 content-start gap-4">
          {hasTicker ? (
            <>
              <MarketOverview
                activePersona={activePersona}
                error={error}
                filters={filters}
                requestState={requestState}
                response={response}
                ticker={ticker}
              />
              <CompanyInsightStrip state={companyInsightState} />

              {response ? (
                <CandidateResults
                  activeTab={activeTab}
                  analysisContext={{
                    dataFreshness: response.dataFreshness,
                    filters: filters as unknown as JsonValue,
                    persona: response.persona,
                    source: "wheel_dashboard",
                    ticker: response.ticker,
                    underlying: response.underlying,
                  }}
                  companyInsightState={companyInsightState}
                  onTabChange={setActiveTab}
                  requestState={requestState}
                  rows={rows}
                  spreadRows={spreadRows}
                  underlyingPrice={response.underlying.price}
                />
              ) : null}
            </>
          ) : (
            <>
              <CompanyScreenerOverview
                activePersona={activePersona}
                error={error}
                filters={filters}
                requestState={requestState}
                response={screenerResponse}
                strategy={screenerStrategy}
              />
              <CompanyResults
                activeStrategy={screenerStrategy}
                companies={screenerResponse?.companies ?? []}
                onSelectStrategy={handleScreenerStrategyChange}
                onSelectTicker={handleSelectCompanyTicker}
                requestState={requestState}
              />
            </>
          )}
        </section>

        <aside className="order-first grid content-start gap-4 xl:order-none">
          <FilterPanel
            filters={filters}
            onChange={handleFiltersChange}
            onReset={() => handleFiltersChange(activePersona.filters)}
          />

          <PresetsPanel
            accessState={presetAccessState}
            defaultPersona={defaultPersona}
            deletingPresetId={deletingPresetId}
            feedback={presetFeedback}
            initialPersonas={initialPersonas}
            onDelete={(id) => void deletePreset(id)}
            onLoad={loadPreset}
            onNameChange={setPresetName}
            onRetry={() => void loadPresets()}
            onSave={() => void savePreset()}
            operation={presetOperation}
            presetName={presetName}
            presets={presets}
            signInHref="/account?next=/screeners"
          />

          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <h2 className="text-sm font-semibold text-white">Data Health</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Use refresh when the market context changes. Cached or stale
              results stay visible, but risk and feed status should be checked
              before acting on a structure.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
