import { AlertTriangle, BarChart3, X } from "lucide-react";
import {
  CompanyContextPanel,
  type CompanyInsightState,
} from "@/components/company-insights";
import { AccessibleOverlay } from "@/components/ui/accessible-overlay";
import type { VerticalSpreadCandidate } from "@/lib/wheel/types";
import { DetailMetric } from "./detail-metric";
import {
  contractValue,
  formatCurrency,
  formatPercent,
  formatScoreLabel,
} from "./formatters";
import {
  legSnapshotFromSpreadLeg,
  PositionLegSnapshotList,
} from "./position-leg-snapshot";
import { qualityClass } from "./styles";
import { TradeAnalysisPanel } from "./trade-analysis-panel";
import type { CandidateAnalysisState } from "./types";
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
              <svg
                aria-hidden="true"
                className="h-full w-full"
                preserveAspectRatio="none"
                viewBox="0 0 100 1"
              >
                <rect
                  className="fill-emerald-300"
                  height="1"
                  rx="0.5"
                  width={Math.max(0, Math.min(value, 100))}
                />
              </svg>
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

export function SpreadDetailDrawer({
  analysis,
  candidate,
  companyInsightState,
  onAnalyze,
  onClose,
}: {
  analysis: CandidateAnalysisState;
  candidate: VerticalSpreadCandidate | null;
  companyInsightState: CompanyInsightState;
  onAnalyze: () => void;
  onClose: () => void;
}) {
  if (!candidate) {
    return null;
  }

  const legSnapshots = [
    legSnapshotFromSpreadLeg({
      expirationDate: candidate.expirationDate,
      leg: candidate.shortLeg,
      optionType: candidate.optionType,
      side: "short",
    }),
    legSnapshotFromSpreadLeg({
      expirationDate: candidate.expirationDate,
      leg: candidate.longLeg,
      optionType: candidate.optionType,
      side: "long",
    }),
  ];

  return (
    <AccessibleOverlay
      description="Review the credit spread ranking, warnings, company context, analysis, and defined-risk payoff. Press Escape to close."
      label="Credit spread details"
      onClose={onClose}
    >
      <section className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl lg:top-1/2 lg:left-1/2 lg:bottom-auto lg:w-[620px] lg:max-w-[calc(100vw-64px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:p-5">
        <SpreadHeader candidate={candidate} onClose={onClose} />
        <div className="mt-5">
          <SpreadScorePanel candidate={candidate} />
        </div>
        <div className="mt-5">
          <CompanyContextPanel
            insights={companyInsightState.data}
            status={companyInsightState.status}
          />
        </div>
        <div className="mt-5">
          <TradeAnalysisPanel analysis={analysis} onAnalyze={onAnalyze} />
        </div>
        <div className="mt-5">
          <SpreadMetrics candidate={candidate} />
        </div>
        <div className="mt-5">
          <PositionLegSnapshotList defaultOpen legs={legSnapshots} />
        </div>
        <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <AlertTriangle className="size-4 text-amber-200" />
            Warnings
          </div>
          <WarningBadges warnings={candidate.warnings} />
        </div>
      </section>
    </AccessibleOverlay>
  );
}
