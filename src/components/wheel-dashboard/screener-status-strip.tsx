import { AlertTriangle, Database, ListChecks, ShieldAlert } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import type {
  PersonaConfig,
  WheelAnalysisResponse,
  WheelCompanyStrategy,
  WheelFilters,
  WheelScreenerResponse,
} from "@/lib/wheel/types";
import type { UsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
import { FreshnessStatusPill, getFreshnessView } from "./freshness-status";
import { MarketSessionStatusTile } from "./market-session-status";
import type { RequestState, StrategyTab } from "./types";

function StatusTile({
  icon: Icon,
  label,
  tone,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone: string;
  value: ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-lg border border-white/10 bg-black/20 px-3">
      <Icon className={`size-4 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          {label}
        </div>
        <div className="truncate text-sm font-medium text-zinc-100">
          {value}
        </div>
      </div>
    </div>
  );
}

export function ScreenerStatusStrip({
  activePersona,
  error,
  filters,
  marketState,
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
  marketState: UsEquitiesMarketState;
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
    : (screenerResponse?.warnings.length ?? 0);
  const rankedCount = response
    ? response.shortPuts.length +
      response.coveredCalls.length +
      response.putCreditSpreads.length +
      response.callCreditSpreads.length
    : (screenerResponse?.companies.length ?? 0);
  const freshnessView = getFreshnessView(freshness, requestState);
  const riskTone = error
    ? "text-red-200"
    : warningCount
      ? "text-amber-200"
      : "text-emerald-200";
  return (
    <section className="border-b border-white/10 bg-[#0f1112]">
      <div className="mx-auto grid max-w-[1600px] gap-2 px-4 py-3 md:grid-cols-5 md:px-6 xl:px-8">
        <StatusTile
          icon={Database}
          label="Feed"
          tone="text-cyan-200"
          value={freshness?.feed.toUpperCase() ?? "Pending"}
        />
        <StatusTile
          icon={freshnessView.icon}
          label="Freshness"
          tone={freshnessView.tone.icon}
          value={
            <FreshnessStatusPill className="w-full" view={freshnessView} />
          }
        />
        <MarketSessionStatusTile initialState={marketState} />
        <StatusTile
          icon={ListChecks}
          label="Ranked"
          tone="text-zinc-200"
          value={`${rankedCount} candidates`}
        />
        <StatusTile
          icon={warningCount || error ? AlertTriangle : ShieldAlert}
          label="Risk flags"
          tone={riskTone}
          value={
            error
              ? "Action needed"
              : warningCount
                ? `${warningCount} warning${warningCount === 1 ? "" : "s"}`
                : "None"
          }
        />
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 md:col-span-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-zinc-500">
            Results generated with
          </div>
          <div className="mt-1 text-sm text-zinc-300">
            {activePersona.name} · {ticker || strategy.replaceAll("_", " ")} ·
            DTE {filters.dteMin}-{filters.dteMax} · Delta {filters.deltaMin}-
            {filters.deltaMax} · {ticker ? tab : strategy.replaceAll("_", " ")}
          </div>
        </div>
      </div>
    </section>
  );
}
