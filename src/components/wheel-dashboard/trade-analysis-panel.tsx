import { AlertTriangle, Brain, CheckCircle2, Clock3, XCircle } from "lucide-react";
import type { CandidateAnalysisState } from "./types";

function verdictLabel(verdict: string) {
  switch (verdict) {
    case "validate":
      return "Validated";
    case "invalidate":
      return "Invalidated";
    case "needs_confirmation":
      return "Needs confirmation";
    case "no_trade":
      return "No trade";
    default:
      return verdict;
  }
}

function verdictClass(verdict: string) {
  switch (verdict) {
    case "validate":
      return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
    case "invalidate":
    case "no_trade":
      return "border-red-300/30 bg-red-400/10 text-red-100";
    case "needs_confirmation":
      return "border-amber-300/30 bg-amber-400/10 text-amber-100";
    default:
      return "border-white/10 bg-white/[0.05] text-zinc-200";
  }
}

function VerdictIcon({ verdict }: { verdict: string }) {
  if (verdict === "validate") {
    return <CheckCircle2 className="size-4" />;
  }

  if (verdict === "invalidate" || verdict === "no_trade") {
    return <XCircle className="size-4" />;
  }

  return <AlertTriangle className="size-4" />;
}

function TextList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">None flagged.</p>;
  }

  return (
    <ul className="grid gap-2 text-sm leading-6 text-zinc-300">
      {items.map((item) => (
        <li className="rounded-md border border-white/10 bg-black/20 px-3 py-2" key={item}>
          {item}
        </li>
      ))}
    </ul>
  );
}

export function TradeAnalysisPanel({
  analysis,
  onAnalyze,
}: {
  analysis: CandidateAnalysisState;
  onAnalyze: () => void;
}) {
  const result = analysis.response?.result;

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-white">
            <Brain className="size-4 text-cyan-200" />
            Trade analysis
          </div>
          <p className="mt-1 text-xs leading-5 text-zinc-500">
            Risk-first model review saved to the audit trail.
          </p>
        </div>
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={analysis.status === "loading"}
          onClick={onAnalyze}
          type="button"
        >
          {analysis.status === "loading" ? "Analyzing..." : result ? "Reanalyze" : "Analyze"}
        </button>
      </div>

      {analysis.status === "loading" ? (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-white/10 bg-white/[0.035] px-3 py-2 text-sm text-zinc-300">
          <Clock3 className="size-4 animate-pulse text-cyan-200" />
          Reviewing setup, chart context, event risk, and risk controls.
        </div>
      ) : null}

      {analysis.status === "error" ? (
        <div className="mt-4 rounded-md border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-100">
          {analysis.error ?? "Unable to analyze this trade."}
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${verdictClass(result.verdict)}`}>
              <VerdictIcon verdict={result.verdict} />
              {verdictLabel(result.verdict)}
            </span>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-xs text-zinc-300">
              Confidence {(result.confidence * 100).toFixed(0)}%
            </span>
            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-zinc-300">
              Server chart indicators
            </span>
          </div>

          <p className="text-sm leading-6 text-zinc-200">{result.summary}</p>

          <div className="grid gap-3">
            <div>
              <div className="mb-2 text-xs uppercase text-zinc-500">Chart read</div>
              <p className="text-sm leading-6 text-zinc-300">{result.chartRead}</p>
            </div>
            <div>
              <div className="mb-2 text-xs uppercase text-zinc-500">Invalidation</div>
              <p className="text-sm leading-6 text-zinc-300">{result.invalidation}</p>
            </div>
            <div>
              <div className="mb-2 text-xs uppercase text-zinc-500">Event risk</div>
              <p className="text-sm leading-6 text-zinc-300">{result.eventRisk}</p>
            </div>
          </div>

          <div>
            <div className="mb-2 text-xs uppercase text-zinc-500">Risk flags</div>
            <TextList items={result.riskFlags} />
          </div>
          <div>
            <div className="mb-2 text-xs uppercase text-zinc-500">Targets</div>
            <TextList items={result.targets} />
          </div>
          <div>
            <div className="mb-2 text-xs uppercase text-zinc-500">Management plan</div>
            <TextList items={result.managementPlan} />
          </div>
          <p className="border-t border-white/10 pt-3 text-xs leading-5 text-zinc-500">
            {result.disclaimer}
          </p>
        </div>
      ) : null}
    </div>
  );
}
