import { AlertTriangle, BarChart3, X } from "lucide-react";
import type { WheelCandidate } from "@/lib/wheel/types";
import { DetailMetric } from "./detail-metric";
import {
  contractValue,
  formatCompactNumber,
  formatCurrency,
  formatPercent,
  formatScoreLabel,
} from "./formatters";
import { qualityClass } from "./styles";
import { WarningBadges } from "./warnings";

function scoreBreakdownRows(candidate: WheelCandidate) {
  const breakdown = candidate.scoreBreakdown;
  const rows: Array<readonly [string, number | undefined]> = [
    ["Yield", breakdown.yield],
    ["Delta fit", breakdown.deltaFit],
    ["DTE fit", breakdown.dteFit],
    ["Liquidity", breakdown.liquidity],
    ["Technical fit", breakdown.technicalFit],
    ["Event risk", breakdown.eventRisk],
    ["Volatility risk", breakdown.volatilityRisk],
    ["Theta efficiency", breakdown.thetaEfficiency],
  ];

  const qualityLabel =
    candidate.optionType === "put" ? "Assignment quality" : "Upside cap quality";
  const qualityValue =
    candidate.optionType === "put"
      ? breakdown.assignmentQuality
      : breakdown.upsideCapQuality;

  return [...rows, [qualityLabel, qualityValue] as const].filter(
    (row): row is readonly [string, number] => row[1] != null,
  );
}

function CandidateHeader({
  candidate,
  onClose,
}: {
  candidate: WheelCandidate;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-xs uppercase text-zinc-500">
          #{candidate.rank} ·{" "}
          {candidate.optionType === "put"
            ? "Cash-Secured Put"
            : "Covered Call"}
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
  );
}

function ScoreBreakdownPanel({
  breakdownRows,
}: {
  breakdownRows: Array<readonly [string, number]>;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
        <BarChart3 className="size-4 text-emerald-200" />
        Why this ranks here
      </div>
      <div className="grid gap-2">
        {breakdownRows.map(([label, value]) => (
          <div className="grid gap-1.5" key={label}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-zinc-400">{label}</span>
              <span className="font-mono text-zinc-100">
                {formatScoreLabel(value)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-emerald-300"
                style={{ width: `${Math.max(0, Math.min(value, 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CashMetrics({
  assignmentOrCalledAway,
  candidate,
  maxCashRequired,
}: {
  assignmentOrCalledAway: number | undefined;
  candidate: WheelCandidate;
  maxCashRequired: number | null;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <DetailMetric
        label="Breakeven"
        value={formatCurrency(candidate.breakeven)}
      />
      <DetailMetric
        label={
          candidate.optionType === "put"
            ? "Assignment price"
            : "Called-away price"
        }
        value={formatCurrency(assignmentOrCalledAway)}
      />
      <DetailMetric label="Spread cost" value={contractValue(candidate.spread)} />
      <DetailMetric
        label="Max cash required"
        value={formatCurrency(maxCashRequired)}
      />
    </div>
  );
}

export function CandidateDetailDrawer({
  candidate,
  underlyingPrice,
  onClose,
}: {
  candidate: WheelCandidate | null;
  underlyingPrice: number | null | undefined;
  onClose: () => void;
}) {
  if (!candidate) {
    return null;
  }

  const quality =
    candidate.optionType === "put"
      ? candidate.assignmentQuality
      : candidate.upsideCapQuality;
  const assignmentOrCalledAway =
    candidate.optionType === "put" ? candidate.strike : candidate.calledAwayPrice;
  const maxCashRequired =
    candidate.optionType === "put"
      ? candidate.strike * 100
      : underlyingPrice == null
        ? null
        : underlyingPrice * 100;
  const breakdownRows = scoreBreakdownRows(candidate);

  return (
    <div
      aria-label="Contract ranking details"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      role="dialog"
    >
      <button
        aria-label="Close contract details"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />

      <section className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl lg:hidden">
        <CandidateHeader candidate={candidate} onClose={onClose} />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <DetailMetric label="Premium" value={contractValue(candidate.midpoint)} />
          <DetailMetric
            label="Premium Yield"
            value={formatPercent(candidate.premiumYield)}
          />
          <DetailMetric
            label="Annualized"
            value={formatPercent(candidate.annualizedYield)}
          />
          <DetailMetric label="Delta" value={candidate.delta?.toFixed(2) ?? "-"} />
          <DetailMetric label="Theta" value={candidate.theta?.toFixed(3) ?? "-"} />
          <DetailMetric label="Expiration" value={candidate.expirationDate} />
          <DetailMetric label="DTE" value={String(candidate.dte)} />
          <DetailMetric label="IV" value={formatPercent(candidate.impliedVolatility)} />
          <DetailMetric label="Volume" value={formatCompactNumber(candidate.volume)} />
          <DetailMetric
            label="Open Interest"
            value={formatCompactNumber(candidate.openInterest)}
          />
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

        <div className="mt-5">
          <ScoreBreakdownPanel breakdownRows={breakdownRows} />
        </div>

        <div className="mt-5">
          <CashMetrics
            assignmentOrCalledAway={assignmentOrCalledAway}
            candidate={candidate}
            maxCashRequired={maxCashRequired}
          />
        </div>
      </section>

      <section className="absolute top-1/2 left-1/2 hidden max-h-[86vh] w-[560px] max-w-[calc(100vw-64px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-white/10 bg-[#151718] p-5 shadow-2xl lg:block">
        <CandidateHeader candidate={candidate} onClose={onClose} />
        <div className="mt-5">
          <ScoreBreakdownPanel breakdownRows={breakdownRows} />
        </div>
        <div className="mt-5">
          <CashMetrics
            assignmentOrCalledAway={assignmentOrCalledAway}
            candidate={candidate}
            maxCashRequired={maxCashRequired}
          />
        </div>
      </section>
    </div>
  );
}
