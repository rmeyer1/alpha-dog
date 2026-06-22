"use client";

import { useState } from "react";
import type {
  VerticalSpreadCandidate,
  WheelCandidate,
  WheelCompanyStrategy,
} from "@/lib/wheel/types";
import type { TradeAnalysisResponse } from "@/lib/trade-analysis/types";
import { CandidateDetailDrawer } from "./candidate-detail-drawer";
import { CandidateMobileCards } from "./candidate-mobile-cards";
import { CandidateTable } from "./candidate-table";
import { SpreadDetailDrawer } from "./spread-detail-drawer";
import { SpreadMobileCards } from "./spread-mobile-cards";
import { SpreadTable } from "./spread-table";
import type {
  CandidateAnalysisContext,
  CandidateAnalysisState,
  RequestState,
  StrategyTab,
} from "./types";

const idleAnalysis: CandidateAnalysisState = { status: "idle" };

type ApiErrorPayload = {
  error: {
    message: string;
  };
};

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}

function strategyForTab(tab: StrategyTab): WheelCompanyStrategy {
  switch (tab) {
    case "calls":
      return "covered_call";
    case "putSpreads":
      return "put_credit_spread";
    case "callSpreads":
      return "call_credit_spread";
    case "puts":
      return "short_put";
  }
}

function CandidateRows({
  analysisContext,
  rows,
  strategy,
  underlyingPrice,
}: {
  analysisContext: CandidateAnalysisContext;
  rows: WheelCandidate[];
  strategy: WheelCompanyStrategy;
  underlyingPrice: number | null | undefined;
}) {
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedCandidate, setSelectedCandidate] =
    useState<WheelCandidate | null>(null);
  const [analysisByKey, setAnalysisByKey] = useState<
    Record<string, CandidateAnalysisState>
  >({});

  function toggleWarnings(contractSymbol: string) {
    setExpandedWarnings((current) => {
      const next = new Set(current);

      if (next.has(contractSymbol)) {
        next.delete(contractSymbol);
      } else {
        next.add(contractSymbol);
      }

      return next;
    });
  }

  async function analyzeCandidate(candidate: WheelCandidate) {
    const key = candidate.contractSymbol;

    setSelectedCandidate(candidate);
    setAnalysisByKey((current) => ({
      ...current,
      [key]: { status: "loading", response: current[key]?.response },
    }));

    try {
      const response = await fetch("/api/trade/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...analysisContext,
          candidate,
          candidateIdentity: {
            key,
            rank: candidate.rank,
            score: candidate.score,
          },
          candidateType: "contract",
          strategy,
        }),
      });
      const payload = (await response.json()) as
        | TradeAnalysisResponse
        | ApiErrorPayload;

      if (!response.ok || isApiErrorPayload(payload)) {
        throw new Error(
          isApiErrorPayload(payload)
            ? payload.error.message
            : "Unable to analyze this trade.",
        );
      }

      setAnalysisByKey((current) => ({
        ...current,
        [key]: { response: payload, status: "success" },
      }));
    } catch (caught) {
      setAnalysisByKey((current) => ({
        ...current,
        [key]: {
          error:
            caught instanceof Error
              ? caught.message
              : "Unable to analyze this trade.",
          response: current[key]?.response,
          status: "error",
        },
      }));
    }
  }

  if (rows.length === 0) {
    return (
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
        No contracts matched this preset. Try widening DTE, delta, or liquidity
        filters.
      </div>
    );
  }

  return (
    <>
      <CandidateTable
        analysisByKey={analysisByKey}
        expandedWarnings={expandedWarnings}
        onAnalyzeCandidate={(candidate) => void analyzeCandidate(candidate)}
        onSelectCandidate={setSelectedCandidate}
        onToggleWarnings={toggleWarnings}
        rows={rows}
      />
      <CandidateMobileCards
        analysisByKey={analysisByKey}
        onAnalyzeCandidate={(candidate) => void analyzeCandidate(candidate)}
        onSelectCandidate={setSelectedCandidate}
        rows={rows}
      />
      <CandidateDetailDrawer
        analysis={
          selectedCandidate
            ? analysisByKey[selectedCandidate.contractSymbol] ?? idleAnalysis
            : idleAnalysis
        }
        candidate={selectedCandidate}
        underlyingPrice={underlyingPrice}
        onAnalyze={() => {
          if (selectedCandidate) {
            void analyzeCandidate(selectedCandidate);
          }
        }}
        onClose={() => setSelectedCandidate(null)}
      />
    </>
  );
}

function SpreadRows({
  analysisContext,
  rows,
  strategy,
}: {
  analysisContext: CandidateAnalysisContext;
  rows: VerticalSpreadCandidate[];
  strategy: WheelCompanyStrategy;
}) {
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedCandidate, setSelectedCandidate] =
    useState<VerticalSpreadCandidate | null>(null);
  const [analysisByKey, setAnalysisByKey] = useState<
    Record<string, CandidateAnalysisState>
  >({});

  function toggleWarnings(id: string) {
    setExpandedWarnings((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  async function analyzeCandidate(candidate: VerticalSpreadCandidate) {
    const key = candidate.id;

    setSelectedCandidate(candidate);
    setAnalysisByKey((current) => ({
      ...current,
      [key]: { status: "loading", response: current[key]?.response },
    }));

    try {
      const response = await fetch("/api/trade/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...analysisContext,
          candidate,
          candidateIdentity: {
            key,
            rank: candidate.rank,
            score: candidate.score,
          },
          candidateType: "vertical_spread",
          strategy,
        }),
      });
      const payload = (await response.json()) as
        | TradeAnalysisResponse
        | ApiErrorPayload;

      if (!response.ok || isApiErrorPayload(payload)) {
        throw new Error(
          isApiErrorPayload(payload)
            ? payload.error.message
            : "Unable to analyze this trade.",
        );
      }

      setAnalysisByKey((current) => ({
        ...current,
        [key]: { response: payload, status: "success" },
      }));
    } catch (caught) {
      setAnalysisByKey((current) => ({
        ...current,
        [key]: {
          error:
            caught instanceof Error
              ? caught.message
              : "Unable to analyze this trade.",
          response: current[key]?.response,
          status: "error",
        },
      }));
    }
  }

  if (rows.length === 0) {
    return (
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
        No credit spreads matched this preset. Try widening spread width,
        lowering return-on-risk, or testing more long legs.
      </div>
    );
  }

  return (
    <>
      <SpreadTable
        analysisByKey={analysisByKey}
        expandedWarnings={expandedWarnings}
        onAnalyzeCandidate={(candidate) => void analyzeCandidate(candidate)}
        onSelectCandidate={setSelectedCandidate}
        onToggleWarnings={toggleWarnings}
        rows={rows}
      />
      <SpreadMobileCards
        analysisByKey={analysisByKey}
        onAnalyzeCandidate={(candidate) => void analyzeCandidate(candidate)}
        onSelectCandidate={setSelectedCandidate}
        rows={rows}
      />
      <SpreadDetailDrawer
        analysis={
          selectedCandidate
            ? analysisByKey[selectedCandidate.id] ?? idleAnalysis
            : idleAnalysis
        }
        candidate={selectedCandidate}
        onAnalyze={() => {
          if (selectedCandidate) {
            void analyzeCandidate(selectedCandidate);
          }
        }}
        onClose={() => setSelectedCandidate(null)}
      />
    </>
  );
}

export function CandidateResults({
  activeTab,
  analysisContext,
  onTabChange,
  requestState,
  spreadRows,
  rows,
  underlyingPrice,
}: {
  activeTab: StrategyTab;
  analysisContext: CandidateAnalysisContext;
  onTabChange: (tab: StrategyTab) => void;
  requestState: RequestState;
  spreadRows: VerticalSpreadCandidate[];
  rows: WheelCandidate[];
  underlyingPrice: number | null | undefined;
}) {
  const isSpreadTab = activeTab === "putSpreads" || activeTab === "callSpreads";
  const rowCount = isSpreadTab ? spreadRows.length : rows.length;
  const activeStrategy = strategyForTab(activeTab);

  return (
    <section className="min-w-0 rounded-lg border border-white/10 bg-[#151718]">
      <div className="flex min-w-0 flex-col items-start gap-3 border-b border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full min-w-0 overflow-x-auto">
          <div className="inline-flex w-max rounded-lg border border-white/10 bg-black/20 p-1">
            <button
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                activeTab === "puts"
                  ? "bg-emerald-300 text-black"
                  : "text-zinc-300 hover:bg-white/[0.06]"
              }`}
              onClick={() => onTabChange("puts")}
              type="button"
            >
              Cash-Secured Puts
            </button>
            <button
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                activeTab === "calls"
                  ? "bg-emerald-300 text-black"
                  : "text-zinc-300 hover:bg-white/[0.06]"
              }`}
              onClick={() => onTabChange("calls")}
              type="button"
            >
              Covered Calls
            </button>
            <button
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                activeTab === "putSpreads"
                  ? "bg-emerald-300 text-black"
                  : "text-zinc-300 hover:bg-white/[0.06]"
              }`}
              onClick={() => onTabChange("putSpreads")}
              type="button"
            >
              Put Credit Spreads
            </button>
            <button
              className={`rounded-md px-4 py-2 text-sm font-medium ${
                activeTab === "callSpreads"
                  ? "bg-emerald-300 text-black"
                  : "text-zinc-300 hover:bg-white/[0.06]"
              }`}
              onClick={() => onTabChange("callSpreads")}
              type="button"
            >
              Call Credit Spreads
            </button>
          </div>
        </div>
        <div className="shrink-0 text-sm text-zinc-400">
          {requestState === "loading" || requestState === "refreshing"
            ? "Loading candidates..."
            : `${rowCount} ranked candidates`}
        </div>
      </div>
      {isSpreadTab ? (
        <SpreadRows
          analysisContext={analysisContext}
          rows={spreadRows}
          strategy={activeStrategy}
        />
      ) : (
        <CandidateRows
          analysisContext={analysisContext}
          rows={rows}
          strategy={activeStrategy}
          underlyingPrice={underlyingPrice}
        />
      )}
    </section>
  );
}
