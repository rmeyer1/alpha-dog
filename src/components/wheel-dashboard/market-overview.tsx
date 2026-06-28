import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { CompanyLogo } from "@/components/company-logo";
import type {
  PersonaConfig,
  WheelAnalysisResponse,
  WheelFilters,
} from "@/lib/wheel/types";
import { formatCurrency, formatPercent } from "./formatters";
import {
  FreshnessStatusPill,
  getFreshnessView,
} from "./freshness-status";
import type { RequestState } from "./types";
import { WarningBadges } from "./warnings";

export function MarketOverview({
  activePersona,
  error,
  filters,
  requestState,
  response,
  ticker,
}: {
  activePersona: PersonaConfig;
  error: string | null;
  filters: WheelFilters;
  requestState: RequestState;
  response: WheelAnalysisResponse | null;
  ticker: string;
}) {
  const freshnessView = getFreshnessView(response?.dataFreshness, requestState);
  const displaySymbol = response?.underlying.symbol ?? ticker.trim().toUpperCase();

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-lg border border-white/10 bg-[#151718] p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <FreshnessStatusPill view={freshnessView} />
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              <CompanyLogo
                name={displaySymbol}
                size="lg"
                symbol={displaySymbol}
              />
              <Link
                className="font-mono text-4xl font-semibold text-white underline decoration-cyan-300/40 underline-offset-4 transition hover:text-cyan-100"
                href={`/company/${encodeURIComponent(displaySymbol)}`}
              >
                {displaySymbol}
              </Link>
              <span className="font-mono text-3xl text-zinc-100">
                {formatCurrency(response?.underlying.price)}
              </span>
              <span className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-sm text-cyan-100">
                {response?.underlying.trend ?? "pending"}
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-300">
              <span>RSI {response?.underlying.rsi14?.toFixed(1) ?? "-"}</span>
              <span>
                MA20 {formatCurrency(response?.underlying.movingAverages.ma20)}
              </span>
              <span>
                MA50 {formatCurrency(response?.underlying.movingAverages.ma50)}
              </span>
              <span>
                MA200 {formatCurrency(response?.underlying.movingAverages.ma200)}
              </span>
            </div>
          </div>
          <div className="max-w-md">
            <div className="text-sm font-medium text-white">
              {activePersona.name}
            </div>
            <p className="mt-1 text-sm text-zinc-400">{activePersona.motto}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-zinc-300">
              <span className="rounded-md bg-white/[0.04] px-2 py-1">
                DTE {filters.dteMin}-{filters.dteMax}
              </span>
              <span className="rounded-md bg-white/[0.04] px-2 py-1">
                Delta {filters.deltaMin}-{filters.deltaMax}
              </span>
              <span className="rounded-md bg-white/[0.04] px-2 py-1">
                Min {formatPercent(filters.minPremiumYield)}
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
  );
}
