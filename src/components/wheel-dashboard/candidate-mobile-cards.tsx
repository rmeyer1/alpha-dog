import { AlertTriangle } from "lucide-react";
import type { WheelCandidate } from "@/lib/wheel/types";
import {
  formatCurrency,
  formatPercent,
} from "./formatters";
import { qualityClass, warningTone } from "./styles";

export function CandidateMobileCards({
  onSelectCandidate,
  rows,
}: {
  onSelectCandidate: (candidate: WheelCandidate) => void;
  rows: WheelCandidate[];
}) {
  return (
    <div className="grid gap-3 p-3 lg:hidden">
      {rows.map((row) => (
        <article
          className="cursor-pointer rounded-lg border border-white/10 bg-black/20 p-4 transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
          key={row.contractSymbol}
          onClick={() => onSelectCandidate(row)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectCandidate(row);
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
  );
}
