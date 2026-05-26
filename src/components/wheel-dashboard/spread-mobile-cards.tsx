import { AlertTriangle } from "lucide-react";
import type { VerticalSpreadCandidate } from "@/lib/wheel/types";
import { formatCurrency, formatPercent } from "./formatters";
import { qualityClass, warningTone } from "./styles";

export function SpreadMobileCards({
  onSelectCandidate,
  rows,
}: {
  onSelectCandidate: (candidate: VerticalSpreadCandidate) => void;
  rows: VerticalSpreadCandidate[];
}) {
  return (
    <div className="grid gap-3 p-3 lg:hidden">
      {rows.map((row) => (
        <article
          className="cursor-pointer rounded-lg border border-white/10 bg-black/20 p-4 transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
          key={row.id}
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
                {formatCurrency(row.shortLeg.strike)} /{" "}
                {formatCurrency(row.longLeg.strike)}
              </div>
            </div>
            <span className="rounded-md bg-emerald-400/10 px-2.5 py-1 font-mono text-emerald-100">
              {row.score}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs text-zinc-500">Credit</div>
              <div className="font-mono">{formatCurrency(row.netCredit)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Max loss</div>
              <div className="font-mono">{formatCurrency(row.maxLoss)}</div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Return / Delta</div>
              <div className="font-mono">
                {formatPercent(row.returnOnRisk)} /{" "}
                {row.shortDelta?.toFixed(2) ?? "-"}
              </div>
            </div>
            <div>
              <div className="text-xs text-zinc-500">Quality</div>
              <div className={qualityClass(row.definedRiskQuality)}>
                {row.definedRiskQuality}
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
