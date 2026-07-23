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
  filters,
  response,
  screenerResponse,
  strategy,
  tab,
  ticker,
  requestState,
}: {
  activePersona: PersonaConfig;
  error: string | null;
  filters: WheelFilters;
  response: WheelAnalysisResponse | null;
  screenerResponse: WheelScreenerResponse | null;
  strategy: WheelCompanyStrategy;
  tab: StrategyTab;
  ticker: string;
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
            Results generated with
          </div>
          <div className="mt-1 text-sm text-zinc-300">
            {activePersona.name} · {ticker || strategy.replaceAll("_", " ")} ·
            {" "}DTE {filters.dteMin}-{filters.dteMax} · Delta{" "}
            {filters.deltaMin}-{filters.deltaMax} ·{" "}
            {ticker ? tab : strategy.replaceAll("_", " ")}
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
  const [appliedTicker, setAppliedTicker] = useState(defaultTicker);
  const [personaId, setPersonaId] = useState<PersonaId>(defaultPersona.id);
  const [filters, setFilters] = useState<WheelFilters>(defaultPersona.filters);
  const [draftFilters, setDraftFilters] =
    useState<WheelFilters>(defaultPersona.filters);
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
  const [urlReady, setUrlReady] = useState(false);
  const [resultIdentity, setResultIdentity] =
    useState<WheelDashboardUrlState>({
      filters: defaultPersona.filters,
      personaId: defaultPersona.id,
      screenerStrategy: defaultScreenerStrategy,
      tab: "puts",
      ticker: defaultTicker,
    });
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

      setRequestState((current) =>
        showAsRefresh ||
        current === "successFresh" ||
        current === "successStale" ||
        current === "refreshing"
          ? "refreshing"
          : "loading"
      );
      setError(null);

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
          setResponse(null);
          setScreenerResponse(nextResponse);
          setResultIdentity({
            filters: nextFilters,
            personaId: nextPersonaId,
            screenerStrategy: nextStrategy,
            tab: tabForStrategy(nextStrategy),
            ticker: "",
          });
          setRequestState(
            nextResponse.dataFreshness.cacheStatus === "stale"
              ? "successStale"
              : "successFresh",
          );
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
          setRequestState("errorNoCache");
          setError(
            caught instanceof Error
              ? caught.message
              : "Unable to load top companies.",
          );
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

    setRequestState((current) =>
      current === "successFresh" ||
      current === "successStale" ||
      current === "refreshing"
        ? "refreshing"
        : "loading"
    );
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
        signal: token.signal,
      });
      const payload = (await apiResponse.json()) as
        | WheelAnalysisResponse
        | { error: { message: string } };

      if (!apiResponse.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error.message : "Analysis failed.",
        );
      }

      requestLifecycle.current.commit(token, () => {
        setTicker(payload.ticker);
        setScreenerResponse(null);
        setResponse(payload);
        setResultIdentity({
          filters: nextFilters,
          personaId: nextPersonaId,
          screenerStrategy:
            nextActiveTab === "calls"
              ? "covered_call"
              : nextActiveTab === "putSpreads"
                ? "put_credit_spread"
                : nextActiveTab === "callSpreads"
                  ? "call_credit_spread"
                  : "short_put",
          tab: nextActiveTab,
          ticker: payload.ticker,
        });
        setRequestState(
          payload.dataFreshness.cacheStatus === "stale"
            ? "successStale"
            : "successFresh",
        );
      });
    } catch (caught) {
      if (
        isAbortError(caught) ||
        !requestLifecycle.current.isActive(token)
      ) {
        return;
      }

      requestLifecycle.current.commit(token, () => {
        setRequestState("errorNoCache");
        setError(caught instanceof Error ? caught.message : "Analysis failed.");
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

    setScreenerResponse(null);
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
      setResponse(null);
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
    setScreenerResponse(null);
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
        setScreenerResponse(null);
      } else {
        setResponse(null);
      }
      setTicker(restored.ticker);
      setAppliedTicker(restored.ticker);
      setPersonaId(restored.personaId);
      setFilters(restored.filters);
      setDraftFilters(restored.filters);
      setActiveTab(restored.tab);
      setScreenerStrategy(restored.screenerStrategy);
      setError(null);
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
        activePersona={displayedPersona}
        error={error}
        filters={displayedFilters}
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
