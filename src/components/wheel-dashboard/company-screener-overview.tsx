import { AlertTriangle } from "lucide-react";
import type {
  PersonaConfig,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerResponse,
} from "@/lib/wheel/types";
import { formatPercent } from "./formatters";
import {
  FreshnessStatusPill,
  getFreshnessView,
} from "./freshness-status";
import type { RequestState } from "./types";
import { WarningBadges } from "./warnings";

export function CompanyScreenerOverview({
  activePersona,
  error,
  filters,
  requestState,
  response,
  strategy,
}: {
  activePersona: PersonaConfig;
  error: string | null;
  filters: WheelFilters;
  requestState: RequestState;
  response: WheelScreenerResponse | null;
  strategy: WheelCompanyStrategy;
}) {
  const freshnessView = getFreshnessView(response?.dataFreshness, requestState);
  const progress = response?.progress;
  const progressPercent = progress && progress.totalCount > 0
    ? Math.round((progress.processedCount / progress.totalCount) * 100)
    : null;
  const title = strategy === "short_put"
    ? "Cash-Secured Put Board"
    : strategy === "put_credit_spread"
      ? "Put Credit Spread Board"
      : strategy === "covered_call"
        ? "Covered Call Board"
        : "Call Credit Spread Board";

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-lg border border-white/10 bg-[#151718] p-5">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
          <div>
            <FreshnessStatusPill view={freshnessView} />
            <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <h2 className="text-3xl font-semibold tracking-normal text-white">
                {title}
              </h2>
              <span className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-sm text-cyan-100">
                NYSE + NASDAQ
              </span>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
              Ranked by fit, liquidity, yield, and risk controls. Use warning
              badges to challenge the score before opening a structure.
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-zinc-300">
              <span>
                {progress
                  ? `${progress.processedCount}/${progress.totalCount} screened`
                  : `${response?.screenedCount ?? "-"} screened`}
              </span>
              <span>{response?.skippedCount ?? "-"} skipped</span>
              <span>{response?.companies.length ?? 0} ranked</span>
              {progressPercent != null &&
              progress?.status === "running" ? (
                <span>{progressPercent}% complete</span>
              ) : null}
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
        <p className="mt-3 text-xs leading-5 text-zinc-500">
          Risk flags should stay visible before yield becomes the deciding
          factor.
        </p>
        {error ? (
          <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
