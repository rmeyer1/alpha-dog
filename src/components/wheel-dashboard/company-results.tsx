"use client";

import { AlertTriangle, Building2 } from "lucide-react";
import type {
  WheelCompanyScore,
  WheelCompanyStrategy,
} from "@/lib/wheel/types";
import {
  formatCurrency,
  formatPercent,
} from "./formatters";
import { qualityClass } from "./styles";
import { TableScrollFrame } from "./table-scroll-frame";
import type { RequestState } from "./types";

function strategyLabel(strategy: WheelCompanyStrategy) {
  switch (strategy) {
    case "short_put":
      return "Cash-Secured Put";
    case "covered_call":
      return "Covered Call";
    case "put_credit_spread":
      return "Put Credit Spread";
    case "call_credit_spread":
      return "Call Credit Spread";
  }
}

const screenerTabs: { label: string; strategy: WheelCompanyStrategy }[] = [
  { label: "Cash-Secured Puts", strategy: "short_put" },
  { label: "Put Credit Spreads", strategy: "put_credit_spread" },
  { label: "Covered Calls", strategy: "covered_call" },
  { label: "Call Credit Spreads", strategy: "call_credit_spread" },
];

function candidateYield(row: WheelCompanyScore) {
  const { bestCandidate } = row;

  if (bestCandidate.returnOnRisk != null) {
    return formatPercent(bestCandidate.returnOnRisk);
  }

  return formatPercent(bestCandidate.premiumYield);
}

function candidatePremium(row: WheelCompanyScore) {
  return formatCurrency(row.bestCandidate.premiumReceived);
}

function candidateStructure(row: WheelCompanyScore) {
  const { bestCandidate } = row;

  if (bestCandidate.longStrike != null) {
    return `${formatCurrency(bestCandidate.shortStrike)} / ${formatCurrency(
      bestCandidate.longStrike,
    )}`;
  }

  return formatCurrency(bestCandidate.shortStrike);
}

function structureHeading(strategy: WheelCompanyStrategy) {
  switch (strategy) {
    case "short_put":
      return "Put Strike";
    case "covered_call":
      return "Call Strike";
    case "put_credit_spread":
      return "Short / Long Put";
    case "call_credit_spread":
      return "Short / Long Call";
  }
}

export function CompanyResults({
  activeStrategy,
  companies,
  onSelectTicker,
  onSelectStrategy,
  requestState,
}: {
  activeStrategy: WheelCompanyStrategy;
  companies: WheelCompanyScore[];
  onSelectTicker: (ticker: string, strategy: WheelCompanyStrategy) => void;
  onSelectStrategy: (strategy: WheelCompanyStrategy) => void;
  requestState: RequestState;
}) {
  const isRanking = requestState === "loading" || requestState === "refreshing";

  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-[#151718]">
      <div className="flex min-w-0 flex-col items-start gap-3 border-b border-white/10 p-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex w-full min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Building2 className="size-4 text-emerald-200" />
            Top Companies
          </div>
          <div className="w-full min-w-0 overflow-x-auto">
            <div className="inline-flex w-max rounded-lg border border-white/10 bg-black/20 p-1">
              {screenerTabs.map((tab) => (
                <button
                  className={`rounded-md px-3 py-2 text-sm font-medium ${
                    activeStrategy === tab.strategy
                      ? "bg-emerald-300 text-black"
                      : "text-zinc-300 hover:bg-white/[0.06]"
                  }`}
                  key={tab.strategy}
                  onClick={() => onSelectStrategy(tab.strategy)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="shrink-0 text-sm text-zinc-400">
          {isRanking
            ? "Ranking companies..."
            : `${companies.length} ranked companies`}
        </div>
      </div>

      {companies.length === 0 ? (
        <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
          {isRanking
            ? "Ranking the first batch of companies..."
            : "No companies matched this persona. Try widening DTE, delta, or liquidity filters."}
        </div>
      ) : (
        <>
          <TableScrollFrame label="Top companies" minWidth={1180}>
            <table className="w-full min-w-[1180px] border-collapse text-left text-sm whitespace-nowrap">
              <thead className="bg-[#1b1d1e] text-xs uppercase text-zinc-400">
                <tr>
                  <th className="sticky left-0 z-20 w-[72px] min-w-[72px] bg-[#1b1d1e] px-4 py-3 font-medium">
                    Rank
                  </th>
                  <th className="sticky left-[72px] z-20 w-[84px] min-w-[84px] bg-[#1b1d1e] px-4 py-3 font-medium">
                    Score
                  </th>
                  <th className="sticky left-[156px] z-20 w-[240px] min-w-[240px] border-r border-white/10 bg-[#1b1d1e] px-4 py-3 font-medium">
                    Company
                  </th>
                  {[
                    "Exchange",
                    "Price",
                    "Trend",
                    "Best Fit",
                    structureHeading(activeStrategy),
                    "Premium",
                    "Exp",
                    "Yield/ROR",
                    "Delta",
                    "IV",
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
                {companies.map((row) => (
                  <tr
                    className="group border-t border-white/10 text-zinc-100 hover:bg-white/[0.035]"
                    key={row.ticker}
                  >
                    <td className="sticky left-0 z-10 w-[72px] min-w-[72px] bg-[#151718] px-4 py-3 font-mono text-zinc-300 group-hover:bg-[#1b1d1e]">
                      #{row.rank}
                    </td>
                    <td className="sticky left-[72px] z-10 w-[84px] min-w-[84px] bg-[#151718] px-4 py-3 group-hover:bg-[#1b1d1e]">
                      <span className="rounded-md bg-emerald-400/10 px-2 py-1 font-mono text-emerald-100">
                        {row.score}
                      </span>
                    </td>
                    <td className="sticky left-[156px] z-10 w-[240px] min-w-[240px] max-w-[240px] border-r border-white/10 bg-[#151718] px-4 py-3 group-hover:bg-[#1b1d1e]">
                      <button
                        className="grid max-w-full rounded-md text-left underline-offset-4 hover:text-emerald-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                        onClick={() =>
                          onSelectTicker(
                            row.ticker,
                            row.bestCandidate.strategy,
                          )
                        }
                        type="button"
                      >
                        <span className="font-mono text-zinc-50">
                          {row.ticker}
                        </span>
                        <span className="truncate text-xs text-zinc-400">
                          {row.name}
                        </span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-300">
                      {row.exchange}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatCurrency(row.underlying.price)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-md border border-cyan-300/30 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100">
                        {row.underlying.trend}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {strategyLabel(row.bestCandidate.strategy)}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {candidateStructure(row)}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {candidatePremium(row)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {row.bestCandidate.expirationDate}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {candidateYield(row)}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {row.bestCandidate.delta?.toFixed(2) ?? "-"}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {formatPercent(row.bestCandidate.impliedVolatility)}
                    </td>
                    <td
                      className={`px-4 py-3 ${qualityClass(
                        row.bestCandidate.liquidityQuality,
                      )}`}
                    >
                      {row.bestCandidate.liquidityQuality}
                    </td>
                    <td className="px-4 py-3">
                      {row.bestCandidate.warningCount > 0 ||
                      row.warnings.length > 0 ||
                      row.errors.length > 0 ? (
                        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-amber-300/25 bg-amber-400/10 px-2 text-xs font-medium text-amber-100">
                          <AlertTriangle className="size-3" />
                          {row.bestCandidate.warningCount +
                            row.warnings.length +
                            row.errors.length}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-500">None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScrollFrame>

          <div className="grid gap-3 p-3 lg:hidden">
            {companies.map((row) => (
              <article
                className="min-w-0 max-w-full cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-black/20 p-4 transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                key={row.ticker}
                onClick={() =>
                  onSelectTicker(row.ticker, row.bestCandidate.strategy)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectTicker(row.ticker, row.bestCandidate.strategy);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="break-words text-xs uppercase text-zinc-500">
                      #{row.rank} · {row.exchange} ·{" "}
                      {strategyLabel(row.bestCandidate.strategy)}
                    </div>
                    <div className="mt-1 font-mono text-lg text-zinc-50">
                      {row.ticker}
                    </div>
                    <div className="truncate text-sm text-zinc-400">
                      {row.name}
                    </div>
                  </div>
                  <span className="rounded-md bg-emerald-400/10 px-2.5 py-1 font-mono text-emerald-100">
                    {row.score}
                  </span>
                </div>
                <div className="mt-4 grid min-w-0 grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-zinc-500">Price / Trend</div>
                    <div className="font-mono">
                      {formatCurrency(row.underlying.price)} /{" "}
                      {row.underlying.trend}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">
                      {structureHeading(activeStrategy)}
                    </div>
                    <div className="break-words font-mono">
                      {candidateStructure(row)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Premium</div>
                    <div className="font-mono">{candidatePremium(row)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Expiration</div>
                    <div className="break-words font-mono">
                      {row.bestCandidate.expirationDate}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-zinc-500">Yield/ROR</div>
                    <div className="font-mono">{candidateYield(row)}</div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
