"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useReducer,
  useState,
} from "react";
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
import type { UsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
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
import {
  parseWheelDashboardState,
  serializeWheelDashboardState,
  type WheelDashboardUrlState,
} from "@/lib/dashboard-url-state";
import {
  isAbortError,
  LatestRequestLifecycle,
  type RequestToken,
} from "@/lib/request-lifecycle";
import { DashboardHeader } from "./wheel-dashboard/dashboard-header";
import { FilterPanel } from "./wheel-dashboard/filter-panel";
import { MarketOverview } from "./wheel-dashboard/market-overview";
import {
  mergePresetFilters,
  personaById,
} from "./wheel-dashboard/persona-utils";
import { PresetsPanel } from "./wheel-dashboard/presets-panel";
import type { StrategyTab } from "./wheel-dashboard/types";
import { useCompanyInsights } from "./wheel-dashboard/use-company-insights";
import { ScreenerStatusStrip } from "./wheel-dashboard/screener-status-strip";
import {
  analysisStrategyForTab,
  dashboardRequestReducer,
  initialDashboardRequestState,
  requestIdentity,
} from "./wheel-dashboard/dashboard-request-state";
import {
  isApiErrorPayload,
  isScreenerRunResponse,
  responseErrorMessage,
  type ApiErrorPayload,
} from "./wheel-dashboard/request-payloads";

export { ScreenerStatusStrip } from "./wheel-dashboard/screener-status-strip";

interface WheelDashboardProps {
  initialMarketState: UsEquitiesMarketState;
  initialPersonas: PersonaConfig[];
}

const defaultTicker = "";
const defaultScreenerStrategy: WheelCompanyStrategy = "short_put";

type PresetOperation = "deleting" | "idle" | "loading" | "saving";

type PresetFeedback = {
  message: string;
  tone: "error" | "success";
};

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

export function WheelDashboard({
  initialMarketState,
  initialPersonas,
}: WheelDashboardProps) {
  const defaultPersona = initialPersonas.find((persona) => persona.default) ??
    initialPersonas[0];
  const [ticker, setTicker] = useState(defaultTicker);
  const [appliedTicker, setAppliedTicker] = useState(defaultTicker);
  const [personaId, setPersonaId] = useState<PersonaId>(defaultPersona.id);
  const [filters, setFilters] = useState<WheelFilters>(defaultPersona.filters);
  const [draftFilters, setDraftFilters] =
    useState<WheelFilters>(defaultPersona.filters);
  const [activeTab, setActiveTab] = useState<StrategyTab>("puts");
  const [screenerStrategy, setScreenerStrategy] =
    useState<WheelCompanyStrategy>(defaultScreenerStrategy);
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
  const [urlReady, setUrlReady] = useState(false);
  const [requestDomain, dispatchRequest] = useReducer(
    dashboardRequestReducer,
    {
      filters: defaultPersona.filters,
      personaId: defaultPersona.id,
      screenerStrategy: defaultScreenerStrategy,
      tab: "puts",
      ticker: defaultTicker,
    },
    initialDashboardRequestState,
  );
  const { error, requestState, response, resultIdentity, screenerResponse } = requestDomain;
  const didLoadPresets = useRef(false);
  const didAutoRefreshInitialScreener = useRef(false);
  const requestLifecycle = useRef(new LatestRequestLifecycle());
  const urlDefaults = useMemo<WheelDashboardUrlState>(() => ({
    filters: defaultPersona.filters,
    personaId: defaultPersona.id,
    screenerStrategy: defaultScreenerStrategy,
    tab: "puts",
    ticker: defaultTicker,
  }), [defaultPersona]);
  const personaIds = useMemo(
    () => initialPersonas.map((persona) => persona.id),
    [initialPersonas],
  );
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

  const pollScreenerRun = useCallback(async (
    runId: string,
    token: RequestToken,
  ) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const apiResponse = await fetch(
        `/api/wheel/screener/runs/${encodeURIComponent(runId)}`,
        {
          cache: "no-store",
          signal: token.signal,
        },
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
      nextFilters,
      nextPersonaId,
      nextStrategy,
      showAsRefresh = false,
    }: {
      forceRefresh?: boolean;
      nextFilters: WheelFilters;
      nextPersonaId: PersonaId;
      nextStrategy: WheelCompanyStrategy;
      showAsRefresh?: boolean;
    }) => {
      const token = requestLifecycle.current.begin();

      dispatchRequest({ type: "requestStarted", refresh: showAsRefresh });

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
          signal: token.signal,
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
          ? payload.result ?? await pollScreenerRun(payload.runId, token)
          : payload;

        const committed = requestLifecycle.current.commit(token, () => {
          dispatchRequest({ type: "screenerLoaded", response: nextResponse, identity: requestIdentity({
            filters: nextFilters,
            personaId: nextPersonaId,
            screenerStrategy: nextStrategy,
            tab: tabForStrategy(nextStrategy),
            ticker: "",
          }) });
        });

        return committed ? nextResponse : null;
      } catch (caught) {
        if (
          isAbortError(caught) ||
          !requestLifecycle.current.isActive(token)
        ) {
          return null;
        }

        requestLifecycle.current.commit(token, () => {
          dispatchRequest({ type: "requestFailed", message: caught instanceof Error ? caught.message : "Unable to load top companies." });
        });

        return null;
      } finally {
        requestLifecycle.current.finish(token);
      }
    },
    [pollScreenerRun],
  );

  const analyzeTicker = useCallback(async ({
    forceRefresh = false,
    nextActiveTab,
    nextFilters,
    nextPersonaId,
    nextTicker,
  }: {
    forceRefresh?: boolean;
    nextActiveTab: StrategyTab;
    nextFilters: WheelFilters;
    nextPersonaId: PersonaId;
    nextTicker: string;
  }) => {
    const symbol = nextTicker.trim().toUpperCase();

    if (!symbol) {
      return;
    }

    const token = requestLifecycle.current.begin();

    dispatchRequest({ type: "requestStarted", refresh: false });

    try {
      const apiResponse = await fetch("/api/wheel/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ticker: symbol,
          persona: nextPersonaId,
          strategy: analysisStrategyForTab(nextActiveTab),
          filters: nextFilters,
          resultLimit: 25,
          forceRefresh,
        }),
        signal: token.signal,
      });
      const payload = (await apiResponse.json()) as
        | WheelAnalysisResponse
        | { error: { message: string } };

      if (!apiResponse.ok || isApiErrorPayload(payload)) {
        throw new Error(responseErrorMessage(payload, "Analysis failed."));
      }
      const analysisResponse = payload as WheelAnalysisResponse;

      requestLifecycle.current.commit(token, () => {
        setTicker(analysisResponse.ticker);
        dispatchRequest({ type: "analysisLoaded", response: analysisResponse, identity: requestIdentity({
          filters: nextFilters,
          personaId: nextPersonaId,
          screenerStrategy: analysisStrategyForTab(nextActiveTab),
          tab: nextActiveTab,
          ticker: analysisResponse.ticker,
        }) });
      });
    } catch (caught) {
      if (
        isAbortError(caught) ||
        !requestLifecycle.current.isActive(token)
      ) {
        return;
      }

      requestLifecycle.current.commit(token, () => {
        dispatchRequest({ type: "requestFailed", message: caught instanceof Error ? caught.message : "Analysis failed." });
      });
    } finally {
      requestLifecycle.current.finish(token);
    }
  }, []);

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

  function writeDashboardUrl(
    state: WheelDashboardUrlState,
    mode: "push" | "replace" = "push",
  ) {
    const query = serializeWheelDashboardState(state).toString();
    const nextUrl = `${window.location.pathname}?${query}`;

    if (`${window.location.pathname}${window.location.search}` === nextUrl) {
      return;
    }

    window.history[mode === "push" ? "pushState" : "replaceState"](
      null,
      "",
      nextUrl,
    );
  }

  function loadPreset(preset: SavedPreset) {
    const nextFilters = mergePresetFilters(initialPersonas, preset, defaultPersona);

    setPersonaId(preset.basePersona);
    setFilters(nextFilters);
    setDraftFilters(nextFilters);
    setPresetName(preset.name);
    writeDashboardUrl({
      filters: nextFilters,
      personaId: preset.basePersona,
      screenerStrategy,
      tab: activeTab,
      ticker: appliedTicker,
    });
  }

  function selectPersona(nextPersonaId: PersonaId) {
    const nextPersona = personaById(initialPersonas, nextPersonaId, defaultPersona);

    setPersonaId(nextPersona.id);
    setFilters(nextPersona.filters);
    setDraftFilters(nextPersona.filters);
    writeDashboardUrl({
      filters: nextPersona.filters,
      personaId: nextPersona.id,
      screenerStrategy,
      tab: activeTab,
      ticker: appliedTicker,
    });
  }

  function handleFiltersChange(nextFilters: WheelFilters) {
    setDraftFilters(nextFilters);
  }

  function handleApplyFilters() {
    setFilters(draftFilters);
    writeDashboardUrl({
      filters: draftFilters,
      personaId,
      screenerStrategy,
      tab: activeTab,
      ticker: appliedTicker,
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTicker = ticker.trim().toUpperCase();

    if (!nextTicker) {
      return;
    }

    dispatchRequest({ type: "clearScreener" });
    setAppliedTicker(nextTicker);
    writeDashboardUrl({
      filters,
      personaId,
      screenerStrategy,
      tab: activeTab,
      ticker: nextTicker,
    });
  }

  function handleTickerChange(nextTicker: string) {
    setTicker(nextTicker);

    if (!nextTicker.trim() && appliedTicker) {
      dispatchRequest({ type: "clearAnalysis" });
      setAppliedTicker("");
      writeDashboardUrl({
        filters,
        personaId,
        screenerStrategy,
        tab: activeTab,
        ticker: "",
      });
    }
  }

  function handleForceRefresh() {
    if (appliedTicker) {
      void analyzeTicker({
        forceRefresh: true,
        nextActiveTab: activeTab,
        nextFilters: filters,
        nextPersonaId: personaId,
        nextTicker: appliedTicker,
      });

      return;
    }

    void loadTopCompanies({
      forceRefresh: true,
      nextFilters: filters,
      nextPersonaId: personaId,
      nextStrategy: screenerStrategy,
    });
  }

  function handleSelectCompanyTicker(
    nextTicker: string,
    strategy: WheelCompanyStrategy,
  ) {
    const nextActiveTab = tabForStrategy(strategy);

    setTicker(nextTicker);
    dispatchRequest({ type: "clearScreener" });
    setAppliedTicker(nextTicker);
    setActiveTab(nextActiveTab);
    writeDashboardUrl({
      filters,
      personaId,
      screenerStrategy,
      tab: nextActiveTab,
      ticker: nextTicker,
    });
  }

  function handleScreenerStrategyChange(strategy: WheelCompanyStrategy) {
    setScreenerStrategy(strategy);
    writeDashboardUrl({
      filters,
      personaId,
      screenerStrategy: strategy,
      tab: activeTab,
      ticker: appliedTicker,
    });
  }

  function handleAnalysisTabChange(tab: StrategyTab) {
    setActiveTab(tab);
    writeDashboardUrl({
      filters,
      personaId,
      screenerStrategy,
      tab,
      ticker: appliedTicker,
    });
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
    const lifecycle = requestLifecycle.current;

    function restoreFromUrl() {
      const restored = parseWheelDashboardState(
        window.location.search,
        urlDefaults,
        personaIds,
      );

      lifecycle.abort();
      if (restored.ticker) {
        dispatchRequest({ type: "clearScreener" });
      } else {
        dispatchRequest({ type: "clearAnalysis" });
      }
      setTicker(restored.ticker);
      setAppliedTicker(restored.ticker);
      setPersonaId(restored.personaId);
      setFilters(restored.filters);
      setDraftFilters(restored.filters);
      setActiveTab(restored.tab);
      setScreenerStrategy(restored.screenerStrategy);
      dispatchRequest({ type: "clearError" });
      setUrlReady(true);
    }

    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);

    return () => {
      window.removeEventListener("popstate", restoreFromUrl);
      lifecycle.abort();
    };
  }, [personaIds, urlDefaults]);

  useEffect(() => {
    if (!urlReady) {
      return;
    }

    let cancelled = false;
    const loadTimer = window.setTimeout(() => {
      void (async () => {
        if (appliedTicker) {
          await analyzeTicker({
            nextActiveTab: activeTab,
            nextFilters: filters,
            nextPersonaId: personaId,
            nextTicker: appliedTicker,
          });
          return;
        }

        const nextResponse = await loadTopCompanies({
          nextFilters: filters,
          nextPersonaId: personaId,
          nextStrategy: screenerStrategy,
        });

        if (
          !cancelled &&
          shouldAutoRefreshScreenerResponse({
            alreadyRefreshed: didAutoRefreshInitialScreener.current,
            response: nextResponse,
          })
        ) {
          didAutoRefreshInitialScreener.current = true;
          void loadTopCompanies({
            forceRefresh: true,
            nextFilters: filters,
            nextPersonaId: personaId,
            nextStrategy: screenerStrategy,
            showAsRefresh: true,
          });
        }
      })();
    }, 0);

    if (!didLoadPresets.current) {
      didLoadPresets.current = true;
      void loadPresets();
    }

    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
    };
  }, [
    activeTab,
    analyzeTicker,
    appliedTicker,
    filters,
    loadTopCompanies,
    personaId,
    screenerStrategy,
    urlReady,
  ]);

  const displayedTab = response ? resultIdentity.tab : activeTab;
  const displayedStrategy = screenerResponse
    ? resultIdentity.screenerStrategy
    : screenerStrategy;
  const displayedFilters = response || screenerResponse
    ? resultIdentity.filters
    : filters;
  const displayedPersona = personaById(
    initialPersonas,
    response || screenerResponse ? resultIdentity.personaId : personaId,
    defaultPersona,
  );
  const rows = displayedTab === "puts"
    ? response?.shortPuts ?? []
    : displayedTab === "calls"
      ? response?.coveredCalls ?? []
      : [];
  const spreadRows = displayedTab === "putSpreads"
    ? response?.putCreditSpreads ?? []
    : displayedTab === "callSpreads"
      ? response?.callCreditSpreads ?? []
      : [];
  const hasTicker = appliedTicker.length > 0;
  const companyInsightState = useCompanyInsights(
    hasTicker ? response?.ticker ?? appliedTicker : null,
  );
  const freshness = response?.dataFreshness ?? screenerResponse?.dataFreshness;
  const isServerRefreshRunning =
    freshness?.refreshStatus === "refreshing" || requestState === "refreshing";
  const hasUnappliedFilterChanges =
    JSON.stringify(draftFilters) !== JSON.stringify(filters);

  return (
    <main className="min-h-screen bg-[#0b0c0d] text-zinc-100">
      <DashboardHeader
        canAnalyze={ticker.trim().length > 0}
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
        activePersona={displayedPersona}
        error={error}
        filters={displayedFilters}
        marketState={initialMarketState}
        requestState={requestState}
        response={response}
        screenerResponse={screenerResponse}
        strategy={displayedStrategy}
        tab={displayedTab}
        ticker={response?.ticker ?? (appliedTicker || resultIdentity.ticker)}
      />

      <div className="mx-auto grid max-w-[1600px] items-start gap-4 px-4 py-5 md:px-6 xl:grid-cols-[minmax(0,1fr)_320px] xl:px-8">
        <section className="grid min-w-0 content-start gap-4">
          {hasTicker ? (
            <>
              <MarketOverview
                activePersona={displayedPersona}
                error={error}
                filters={displayedFilters}
                requestState={requestState}
                response={response}
                ticker={response?.ticker ?? appliedTicker}
              />
              <CompanyInsightStrip state={companyInsightState} />

              {response ? (
                <CandidateResults
                  activeTab={displayedTab}
                  analysisContext={{
                    dataFreshness: response.dataFreshness,
                    filters: displayedFilters as unknown as JsonValue,
                    persona: response.persona,
                    source: "wheel_dashboard",
                    ticker: response.ticker,
                    underlying: response.underlying,
                  }}
                  companyInsightState={companyInsightState}
                  onTabChange={handleAnalysisTabChange}
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
                activePersona={displayedPersona}
                error={error}
                filters={displayedFilters}
                requestState={requestState}
                response={screenerResponse}
                strategy={displayedStrategy}
              />
              <CompanyResults
                activeStrategy={displayedStrategy}
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
            filters={draftFilters}
            hasUnappliedChanges={hasUnappliedFilterChanges}
            onApply={handleApplyFilters}
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
