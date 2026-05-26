"use client";

import { useState } from "react";
import type { WheelCandidate } from "@/lib/wheel/types";
import { CandidateDetailDrawer } from "./candidate-detail-drawer";
import { CandidateMobileCards } from "./candidate-mobile-cards";
import { CandidateTable } from "./candidate-table";
import type { RequestState } from "./types";

type ActiveTab = "puts" | "calls";

function CandidateRows({
  rows,
  underlyingPrice,
}: {
  rows: WheelCandidate[];
  underlyingPrice: number | null | undefined;
}) {
  const [expandedWarnings, setExpandedWarnings] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedCandidate, setSelectedCandidate] =
    useState<WheelCandidate | null>(null);

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
        expandedWarnings={expandedWarnings}
        onSelectCandidate={setSelectedCandidate}
        onToggleWarnings={toggleWarnings}
        rows={rows}
      />
      <CandidateMobileCards
        onSelectCandidate={setSelectedCandidate}
        rows={rows}
      />
      <CandidateDetailDrawer
        candidate={selectedCandidate}
        underlyingPrice={underlyingPrice}
        onClose={() => setSelectedCandidate(null)}
      />
    </>
  );
}

export function CandidateResults({
  activeTab,
  onTabChange,
  requestState,
  rows,
  underlyingPrice,
}: {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  requestState: RequestState;
  rows: WheelCandidate[];
  underlyingPrice: number | null | undefined;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-[#151718]">
      <div className="flex flex-col items-start gap-3 border-b border-white/10 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="inline-flex w-fit rounded-lg border border-white/10 bg-black/20 p-1">
          <button
            className={`rounded-md px-4 py-2 text-sm font-medium ${
              activeTab === "puts"
                ? "bg-emerald-300 text-black"
                : "text-zinc-300 hover:bg-white/[0.06]"
            }`}
            onClick={() => onTabChange("puts")}
            type="button"
          >
            Short Puts
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
        </div>
        <div className="text-sm text-zinc-400">
          {requestState === "loading" || requestState === "refreshing"
            ? "Loading candidates..."
            : `${rows.length} ranked candidates`}
        </div>
      </div>
      <CandidateRows rows={rows} underlyingPrice={underlyingPrice} />
    </section>
  );
}
