"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  ChevronDown,
  Clock3,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  PersonaConfig,
  PersonaId,
  SavedPreset,
  Warning,
  WheelAnalysisResponse,
  WheelCandidate,
  WheelFilters,
} from "@/lib/wheel/types";

type RequestState =
  | "idle"
  | "loading"
  | "successFresh"
  | "successStale"
  | "refreshing"
  | "errorNoCache";

interface WheelDashboardProps {
  initialPersonas: PersonaConfig[];
}

const defaultTicker = "AAPL";

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "-";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return "-";

  return `${(value * 100).toFixed(1)}%`;
}

function badgeClass(severity: Warning["severity"]) {
  if (severity === "danger") {
    return "border-red-400/40 bg-red-500/15 text-red-100";
  }

  if (severity === "warning") {
    return "border-amber-300/40 bg-amber-400/15 text-amber-100";
  }

  return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
}

function qualityClass(quality: string) {
  if (quality === "excellent" || quality === "good") {
    return "text-emerald-200";
  }

  if (quality === "weak" || quality === "poor") {
    return "text-amber-200";
  }

  return "text-zinc-300";
}

function WarningBadges({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) {
    return <span className="text-xs text-zinc-500">None</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {warnings.map((warning, index) => (
        <span
          aria-label={`${warning.severity}: ${warning.message}`}
          className={`rounded-md border px-2 py-1 text-[11px] font-medium ${badgeClass(warning.severity)}`}
          key={`${warning.type}-${index}`}
        >
          {warning.message}
        </span>
      ))}
    </div>
  );
}

function warningTone(warnings: Warning[]) {
  if (warnings.some((warning) => warning.severity === "danger")) {
    return "border-red-400/40 bg-red-500/15 text-red-100";
  }

  if (warnings.some((warning) => warning.severity === "warning")) {
    return "border-amber-300/40 bg-amber-400/15 text-amber-100";
  }

  return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
}

function CompactWarnings({
  warnings,
  expanded,
  onToggle,
}: {
  warnings: Warning[];
  expanded: boolean;
  onToggle: () => void;
}) {
  if (warnings.length === 0) {
    return <span className="text-sm text-zinc-500">None</span>;
  }

  return (
    <div className="max-w-[260px]">
      <button
        aria-expanded={expanded}
        className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition hover:brightness-125 ${warningTone(warnings)}`}
        onClick={onToggle}
        type="button"
      >
        <AlertTriangle className="size-3" />
        <span>
          {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
        </span>
        <ChevronDown
          className={`size-3 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
      {expanded ? (
        <div className="mt-2 grid gap-1.5 whitespace-normal">
          {warnings.map((warning, index) => (
            <div
              className={`rounded-md border px-2.5 py-2 text-xs leading-5 ${badgeClass(warning.severity)}`}
              key={`${warning.type}-${index}`}
            >
              {warning.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function DetailMetric({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-sm text-zinc-100 ${className}`}>
        {value}
      </div>
    </div>
  );
}

function MobileCandidateOverlay({
  candidate,
  onClose,
}: {
  candidate: WheelCandidate | null;
  onClose: () => void;
}) {
  if (!candidate) {
    return null;
  }

  const quality =
    candidate.optionType === "put"
      ? candidate.assignmentQuality
      : candidate.upsideCapQuality;

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm lg:hidden"
      role="dialog"
    >
      <button
        aria-label="Close contract details"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <section className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase text-zinc-500">
              #{candidate.rank} · {candidate.optionType === "put" ? "Short Put" : "Covered Call"}
            </div>
            <h2 className="mt-1 font-mono text-2xl font-semibold text-white">
              {formatCurrency(candidate.strike)}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {candidate.expirationDate} · {candidate.dte} DTE
            </p>
          </div>
          <button
            aria-label="Close contract details"
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <DetailMetric label="Premium" value={formatCurrency(candidate.midpoint)} />
          <DetailMetric label="Premium Yield" value={formatPercent(candidate.premiumYield)} />
          <DetailMetric label="Annualized" value={formatPercent(candidate.annualizedYield)} />
          <DetailMetric label="Delta" value={candidate.delta?.toFixed(2) ?? "-"} />
          <DetailMetric label="Theta" value={candidate.theta?.toFixed(3) ?? "-"} />
          <DetailMetric label="Expiration" value={candidate.expirationDate} />
          <DetailMetric label="DTE" value={String(candidate.dte)} />
          <DetailMetric label="IV" value={formatPercent(candidate.impliedVolatility)} />
          <DetailMetric label="Volume" value={String(candidate.volume ?? "-")} />
          <DetailMetric label="Open Interest" value={String(candidate.openInterest ?? "-")} />
          <DetailMetric
            className={qualityClass(quality ?? "unknown")}
            label="Quality"
            value={quality ?? "unknown"}
          />
          <DetailMetric
            label="Bid/Ask"
            value={`${formatCurrency(candidate.bid)}/${formatCurrency(candidate.ask)}`}
          />
        </div>

        <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <AlertTriangle className="size-4 text-amber-200" />
            Warnings
          </div>
          <WarningBadges warnings={candidate.warnings} />
        </div>
      </section>
    </div>
  );
}

function CandidateRows({ rows }: { rows: WheelCandidate[] }) {
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedCandidate, setSelectedCandidate] =
    useState<WheelCandidate | null>(null);

  function toggleWarnings(contractSymbol: string) {
    setExpandedWarnings((current) => {
      const next = new Set(current);

      if (next.has(contractSymbol)) {
        next.delete(contractSymbol);
      } else {
        next.add(contractSymbol);
      }

      return next;
    });
  }

  if (rows.length === 0) {
    return (
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
        No contracts matched this preset. Try widening DTE, delta, or liquidity
        filters.
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[1310px] border-collapse text-left text-sm whitespace-nowrap">
          <thead className="bg-white/[0.03] text-xs uppercase text-zinc-400">
            <tr>
              {[
                "Rank",
                "Score",
                "Strike",
                "Exp",
                "DTE",
                "Bid/Ask",
                "Mid",
                "Prem",
                "Ann.",
                "Delta",
                "Theta",
                "IV",
                "Vol/OI",
                "Quality",
                "Warnings",
              ].map((heading) => (
                <th className="px-4 py-3 font-medium" key={heading}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className="border-t border-white/10 text-zinc-100 hover:bg-white/[0.035]"
                key={row.contractSymbol}
              >
                <td className="px-4 py-3 font-mono text-zinc-300">
                  #{row.rank}
                </td>
                <td className="px-4 py-3">
                  <span className="rounded-md bg-emerald-400/10 px-2 py-1 font-mono text-emerald-100">
                    {row.score}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono">
                  {formatCurrency(row.strike)}
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  {row.expirationDate}
                </td>
                <td className="px-4 py-3 font-mono">{row.dte}</td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {formatCurrency(row.bid)}/{formatCurrency(row.ask)}
                </td>
                <td className="px-4 py-3 font-mono">
                  {formatCurrency(row.midpoint)}
                </td>
                <td className="px-4 py-3 font-mono">
                  {formatPercent(row.premiumYield)}
                </td>
                <td className="px-4 py-3 font-mono">
                  {formatPercent(row.annualizedYield)}
                </td>
                <td className="px-4 py-3 font-mono">
                  {row.delta?.toFixed(2) ?? "-"}
                </td>
                <td className="px-4 py-3 font-mono">
                  {row.theta?.toFixed(3) ?? "-"}
                </td>
                <td className="px-4 py-3 font-mono">
                  {formatPercent(row.impliedVolatility)}
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">
                  {row.volume ?? "-"}/{row.openInterest ?? "-"}
                </td>
                <td className={`px-4 py-3 ${qualityClass(row.liquidityQuality)}`}>
                  {row.optionType === "put"
                    ? row.assignmentQuality
                    : row.upsideCapQuality}
                </td>
                <td className="w-[180px] px-4 py-2 align-middle">
                  <CompactWarnings
                    expanded={expandedWarnings.has(row.contractSymbol)}
                    onToggle={() => toggleWarnings(row.contractSymbol)}
                    warnings={row.warnings}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 p-3 lg:hidden">
        {rows.map((row) => (
          <article
            className="cursor-pointer rounded-lg border border-white/10 bg-black/20 p-4 transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
            key={row.contractSymbol}
            onClick={() => setSelectedCandidate(row)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelectedCandidate(row);
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase text-zinc-500">
                  #{row.rank} · {row.expirationDate} · {row.dte} DTE
                </div>
                <div className="mt-1 font-mono text-lg text-zinc-50">
                  {formatCurrency(row.strike)}
                </div>
              </div>
              <span className="rounded-md bg-emerald-400/10 px-2.5 py-1 font-mono text-emerald-100">
                {row.score}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-zinc-500">Premium</div>
                <div className="font-mono">{formatPercent(row.premiumYield)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Annualized</div>
                <div className="font-mono">{formatPercent(row.annualizedYield)}</div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Delta / Mid</div>
                <div className="font-mono">
                  {row.delta?.toFixed(2) ?? "-"} / {formatCurrency(row.midpoint)}
                </div>
              </div>
              <div>
                <div className="text-xs text-zinc-500">Liquidity</div>
                <div className={qualityClass(row.liquidityQuality)}>
                  {row.liquidityQuality}
                </div>
              </div>
            </div>
            <div className="mt-4">
              {row.warnings.length > 0 ? (
                <span className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium ${warningTone(row.warnings)}`}>
                  <AlertTriangle className="size-3" />
                  {row.warnings.length}{" "}
                  {row.warnings.length === 1 ? "warning" : "warnings"}
                </span>
              ) : (
                <span className="text-xs text-zinc-500">No warnings</span>
              )}
            </div>
          </article>
        ))}
      </div>
      <MobileCandidateOverlay
        candidate={selectedCandidate}
        onClose={() => setSelectedCandidate(null)}
      />
    </>
  );
}

export function WheelDashboard({ initialPersonas }: WheelDashboardProps) {
  const defaultPersona = initialPersonas.find((persona) => persona.default) ??
    initialPersonas[0];
  const [ticker, setTicker] = useState(defaultTicker);
  const [personaId, setPersonaId] = useState<PersonaId>(defaultPersona.id);
  const [activeTab, setActiveTab] = useState<"puts" | "calls">("puts");
  const [response, setResponse] = useState<WheelAnalysisResponse | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<SavedPreset[]>([]);
  const [presetName, setPresetName] = useState("Balanced 21-30 DTE");
  const activePersona = useMemo(
    () =>
      initialPersonas.find((persona) => persona.id === personaId) ??
      defaultPersona,
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
    const filters: Partial<WheelFilters> = activePersona.filters;
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
    setPresetName(preset.name);
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
  }, [defaultPersona.id]);

  const rows = activeTab === "puts"
    ? response?.shortPuts ?? []
    : response?.coveredCalls ?? [];

  return (
    <main className="min-h-screen bg-[#0b0c0d] text-zinc-100">
      <div className="border-b border-white/10 bg-[#111314]">
        <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 md:px-6 xl:px-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-400/10">
                <BarChart3 className="size-5 text-emerald-200" />
              </div>
              <div>
                <h1 className="text-xl font-semibold tracking-normal text-white">
                  Alpha Dog
                </h1>
                <p className="text-sm text-zinc-400">
                  Wheel strategy decision dashboard
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <ShieldAlert className="size-4 text-amber-200" />
              Decision support only. Not financial advice.
            </div>
          </div>

          <form
            className="grid gap-3 md:grid-cols-[minmax(180px,240px)_minmax(220px,280px)_auto_auto] md:items-end"
            onSubmit={handleSubmit}
          >
            <label className="grid gap-1.5 text-sm">
              <span className="text-zinc-400">Ticker</span>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3">
                <Search className="size-4 text-zinc-500" />
                <input
                  className="w-full bg-transparent font-mono text-base text-white outline-none"
                  onChange={(event) => setTicker(event.target.value.toUpperCase())}
                  value={ticker}
                  aria-label="Ticker symbol"
                />
              </div>
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="text-zinc-400">Strategy persona</span>
              <select
                className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
                onChange={(event) => setPersonaId(event.target.value as PersonaId)}
                value={personaId}
              >
                {initialPersonas.map((persona) => (
                  <option key={persona.id} value={persona.id}>
                    {persona.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-black transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={requestState === "loading" || requestState === "refreshing"}
              type="submit"
            >
              <Activity className="size-4" />
              Analyze
            </button>

            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
              onClick={() => void analyze(true)}
              type="button"
            >
              <RefreshCw className="size-4" />
              Refresh
            </button>
          </form>
        </div>
      </div>

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-5 md:px-6 xl:grid-cols-[1fr_320px] xl:px-8">
        <section className="grid gap-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div className="rounded-lg border border-white/10 bg-[#151718] p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
                <div>
                  <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Clock3 className="size-4" />
                    {response
                      ? `${response.dataFreshness.feed.toUpperCase()} · ${response.dataFreshness.cacheStatus}`
                      : requestState}
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
                    <h2 className="font-mono text-4xl font-semibold text-white">
                      {response?.underlying.symbol ?? ticker}
                    </h2>
                    <span className="font-mono text-3xl text-zinc-100">
                      {formatCurrency(response?.underlying.price)}
                    </span>
                    <span className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-sm text-cyan-100">
                      {response?.underlying.trend ?? "pending"}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-300">
                    <span>RSI {response?.underlying.rsi14?.toFixed(1) ?? "-"}</span>
                    <span>MA20 {formatCurrency(response?.underlying.movingAverages.ma20)}</span>
                    <span>MA50 {formatCurrency(response?.underlying.movingAverages.ma50)}</span>
                    <span>MA200 {formatCurrency(response?.underlying.movingAverages.ma200)}</span>
                  </div>
                </div>
                <div className="max-w-md">
                  <div className="text-sm font-medium text-white">
                    {activePersona.name}
                  </div>
                  <p className="mt-1 text-sm text-zinc-400">{activePersona.motto}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-300">
                    <span className="rounded-md bg-white/[0.04] px-2 py-1">
                      DTE {activePersona.filters.dteMin}-{activePersona.filters.dteMax}
                    </span>
                    <span className="rounded-md bg-white/[0.04] px-2 py-1">
                      Delta {activePersona.filters.deltaMin}-{activePersona.filters.deltaMax}
                    </span>
                    <span className="rounded-md bg-white/[0.04] px-2 py-1">
                      Min {formatPercent(activePersona.filters.minPremiumYield)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#151718] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-white">
                <AlertTriangle className="size-4 text-amber-200" />
                Global Risk
              </div>
              <div className="mt-3">
                <WarningBadges warnings={response?.warnings ?? []} />
              </div>
              {error ? (
                <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <section className="overflow-hidden rounded-lg border border-white/10 bg-[#151718]">
            <div className="flex flex-col items-start gap-3 border-b border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex w-fit rounded-lg border border-white/10 bg-black/20 p-1">
                <button
                  className={`rounded-md px-4 py-2 text-sm font-medium ${
                    activeTab === "puts"
                      ? "bg-emerald-300 text-black"
                      : "text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                  onClick={() => setActiveTab("puts")}
                  type="button"
                >
                  Short Puts
                </button>
                <button
                  className={`rounded-md px-4 py-2 text-sm font-medium ${
                    activeTab === "calls"
                      ? "bg-emerald-300 text-black"
                      : "text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                  onClick={() => setActiveTab("calls")}
                  type="button"
                >
                  Covered Calls
                </button>
              </div>
              <div className="text-sm text-zinc-400">
                {requestState === "loading" || requestState === "refreshing"
                  ? "Loading candidates..."
                  : `${rows.length} ranked candidates`}
              </div>
            </div>
            <CandidateRows rows={rows} />
          </section>
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <h2 className="text-sm font-semibold text-white">Saved Presets</h2>
            <div className="mt-4 grid gap-3">
              <label className="grid gap-1.5 text-sm">
                <span className="text-zinc-400">Preset name</span>
                <input
                  className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
                  onChange={(event) => setPresetName(event.target.value)}
                  value={presetName}
                />
              </label>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                onClick={() => void savePreset()}
                type="button"
              >
                <Save className="size-4" />
                Save Current Persona
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
                      onClick={() => loadPreset(preset)}
                      type="button"
                    >
                      <div className="text-sm font-medium text-white">
                        {preset.name}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {preset.basePersona.replaceAll("_", " ")}
                      </div>
                    </button>
                    <button
                      aria-label={`Delete ${preset.name}`}
                      className="flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.06] hover:text-red-200"
                      onClick={() => void deletePreset(preset.id)}
                      type="button"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

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
