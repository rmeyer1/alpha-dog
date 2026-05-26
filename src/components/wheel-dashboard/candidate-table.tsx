import type { WheelCandidate } from "@/lib/wheel/types";
import {
  formatCurrency,
  formatPercent,
} from "./formatters";
import { qualityClass } from "./styles";
import { CompactWarnings } from "./warnings";

export function CandidateTable({
  expandedWarnings,
  onSelectCandidate,
  onToggleWarnings,
  rows,
}: {
  expandedWarnings: Set<string>;
  onSelectCandidate: (candidate: WheelCandidate) => void;
  onToggleWarnings: (contractSymbol: string) => void;
  rows: WheelCandidate[];
}) {
  return (
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
              <td className="px-4 py-3 font-mono text-zinc-300">#{row.rank}</td>
              <td className="px-4 py-3">
                <span className="rounded-md bg-emerald-400/10 px-2 py-1 font-mono text-emerald-100">
                  {row.score}
                </span>
              </td>
              <td className="px-4 py-3 font-mono">
                <button
                  className="rounded-md text-left text-zinc-50 underline-offset-4 hover:text-emerald-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                  onClick={() => onSelectCandidate(row)}
                  type="button"
                >
                  {formatCurrency(row.strike)}
                </button>
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
                  onToggle={() => onToggleWarnings(row.contractSymbol)}
                  warnings={row.warnings}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
