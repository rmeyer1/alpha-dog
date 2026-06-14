import type { VerticalSpreadCandidate } from "@/lib/wheel/types";
import {
  contractValue,
  formatCompactNumber,
  formatCurrency,
  formatPercent,
} from "./formatters";
import { qualityClass } from "./styles";
import { CompactWarnings } from "./warnings";

export function SpreadTable({
  expandedWarnings,
  onSelectCandidate,
  onToggleWarnings,
  rows,
}: {
  expandedWarnings: Set<string>;
  onSelectCandidate: (candidate: VerticalSpreadCandidate) => void;
  onToggleWarnings: (id: string) => void;
  rows: VerticalSpreadCandidate[];
}) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[1320px] border-collapse text-left text-sm whitespace-nowrap">
        <thead className="bg-white/[0.03] text-xs uppercase text-zinc-400">
          <tr>
            {[
              "Rank",
              "Score",
              "Short/Long",
              "Width",
              "Exp",
              "DTE",
              "Premium",
              "Max Loss",
              "ROR",
              "B/E",
              "Delta",
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
              key={row.id}
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
                  {formatCurrency(row.shortLeg.strike)} /{" "}
                  {formatCurrency(row.longLeg.strike)}
                </button>
              </td>
              <td className="px-4 py-3 font-mono">{formatCurrency(row.width)}</td>
              <td className="px-4 py-3 font-mono text-xs">
                {row.expirationDate}
              </td>
              <td className="px-4 py-3 font-mono">{row.dte}</td>
              <td className="px-4 py-3 font-mono">
                {contractValue(row.netCredit)}
              </td>
              <td className="px-4 py-3 font-mono">
                {formatCurrency(row.maxLoss)}
              </td>
              <td className="px-4 py-3 font-mono">
                {formatPercent(row.returnOnRisk)}
              </td>
              <td className="px-4 py-3 font-mono">
                {formatCurrency(row.breakeven)}
              </td>
              <td className="px-4 py-3 font-mono">
                {row.shortDelta?.toFixed(2) ?? "-"}
              </td>
              <td className="px-4 py-3 font-mono tabular-nums">
                {formatCompactNumber(row.volume)}/{formatCompactNumber(row.openInterest)}
              </td>
              <td className={`px-4 py-3 ${qualityClass(row.definedRiskQuality)}`}>
                {row.definedRiskQuality}
              </td>
              <td className="w-[180px] px-4 py-2 align-middle">
                <CompactWarnings
                  expanded={expandedWarnings.has(row.id)}
                  onToggle={() => onToggleWarnings(row.id)}
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
