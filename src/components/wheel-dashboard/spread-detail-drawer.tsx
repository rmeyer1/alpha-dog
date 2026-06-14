import { AlertTriangle, BarChart3, X } from "lucide-react";
import type { SpreadLeg, VerticalSpreadCandidate } from "@/lib/wheel/types";
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

function spreadTitle(candidate: VerticalSpreadCandidate) {
  return candidate.strategy === "put_credit_spread"
    ? "Put Credit Spread"
    : "Call Credit Spread";
}

function spreadBreakdownRows(candidate: VerticalSpreadCandidate) {
  const breakdown = candidate.scoreBreakdown;
  const definedRisk =
    candidate.optionType === "put"
      ? breakdown.assignmentQuality
      : breakdown.upsideCapQuality;
  const rows: Array<readonly [string, number | undefined]> = [
    ["Return on risk", breakdown.yield],
    ["Short delta fit", breakdown.deltaFit],
    ["DTE fit", breakdown.dteFit],
    ["Liquidity", breakdown.liquidity],
    ["Technical fit", breakdown.technicalFit],
    ["Event risk", breakdown.eventRisk],
    ["Volatility risk", breakdown.volatilityRisk],
    ["Theta efficiency", breakdown.thetaEfficiency],
    ["Defined risk quality", definedRisk],
  ];

  return rows.filter((row): row is readonly [string, number] => row[1] != null);
}

function SpreadHeader({
  candidate,
  onClose,
}: {
  candidate: VerticalSpreadCandidate;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-xs uppercase text-zinc-500">
          #{candidate.rank} · {spreadTitle(candidate)}
        </div>
        <h2 className="mt-1 font-mono text-2xl font-semibold text-white">
          {formatCurrency(candidate.shortLeg.strike)} /{" "}
          {formatCurrency(candidate.longLeg.strike)}
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          {candidate.expirationDate} · {candidate.dte} DTE · $
          {candidate.width.toFixed(0)} wide
        </p>
      </div>
      <button
        aria-label="Close spread details"
        className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200"
        onClick={onClose}
        type="button"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function SpreadScorePanel({ candidate }: { candidate: VerticalSpreadCandidate }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
        <BarChart3 className="size-4 text-emerald-200" />
        Why this ranks here
      </div>
      <div className="grid gap-2">
        {spreadBreakdownRows(candidate).map(([label, value]) => (
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

function SpreadMetrics({ candidate }: { candidate: VerticalSpreadCandidate }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <DetailMetric label="Premium" value={contractValue(candidate.netCredit)} />
      <DetailMetric label="Max loss" value={formatCurrency(candidate.maxLoss)} />
      <DetailMetric
        label="Return on risk"
        value={formatPercent(candidate.returnOnRisk)}
      />
      <DetailMetric label="Breakeven" value={formatCurrency(candidate.breakeven)} />
      <DetailMetric label="Width" value={formatCurrency(candidate.width)} />
      <DetailMetric
        className={qualityClass(candidate.definedRiskQuality)}
        label="Quality"
        value={candidate.definedRiskQuality}
      />
    </div>
  );
}

function LegDetails({ candidate }: { candidate: VerticalSpreadCandidate }) {
  const legs: Array<readonly [string, SpreadLeg]> = [
    ["Short leg", candidate.shortLeg],
    ["Long leg", candidate.longLeg],
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {legs.map(([label, leg]) => (
        <div
          className="rounded-lg border border-white/10 bg-white/[0.035] p-3"
          key={label}
        >
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="mt-2 grid gap-1 font-mono text-xs text-zinc-300">
            <span>Strike {formatCurrency(leg.strike)}</span>
            <span>
              Bid/Ask {formatCurrency(leg.bid)}/{formatCurrency(leg.ask)}
            </span>
            <span>Delta {leg.delta?.toFixed(2) ?? "-"}</span>
            <span>
              Vol/OI {formatCompactNumber(leg.volume)}/
              {formatCompactNumber(leg.openInterest)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SpreadDetailDrawer({
  candidate,
  onClose,
}: {
  candidate: VerticalSpreadCandidate | null;
  onClose: () => void;
}) {
  if (!candidate) {
    return null;
  }

  return (
    <div
      aria-label="Credit spread details"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      role="dialog"
    >
      <button
        aria-label="Close spread details"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <section className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl lg:top-1/2 lg:left-1/2 lg:bottom-auto lg:w-[620px] lg:max-w-[calc(100vw-64px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:p-5">
        <SpreadHeader candidate={candidate} onClose={onClose} />
        <div className="mt-5">
          <SpreadScorePanel candidate={candidate} />
        </div>
        <div className="mt-5">
          <SpreadMetrics candidate={candidate} />
        </div>
        <div className="mt-5">
          <LegDetails candidate={candidate} />
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
