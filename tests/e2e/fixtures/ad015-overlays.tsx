import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PaperPositionsPanel } from "../../../src/components/account/paper-positions-panel";
import {
  FilingAnalysisCards,
} from "../../../src/app/company/[ticker]/filing-intelligence";
import { WalletDrawer } from "../../../src/components/trader-intelligence";
import { AddPositionModal } from "../../../src/components/wheel-dashboard/add-position-modal";
import { CandidateDetailDrawer } from "../../../src/components/wheel-dashboard/candidate-detail-drawer";
import { SpreadDetailDrawer } from "../../../src/components/wheel-dashboard/spread-detail-drawer";
import type { OpenPositionCandidateRequest } from "../../../src/components/wheel-dashboard/candidate-results";
import type { CandidateAnalysisContext } from "../../../src/components/wheel-dashboard/types";
import type {
  SignalScribeAnalysis,
  SignalScribeFiling,
} from "../../../src/lib/company-profile";
import type { TraderWalletProfile } from "../../../src/lib/polymarket/types";
import type {
  VerticalSpreadCandidate,
  WheelCandidate,
} from "../../../src/lib/wheel/types";

const candidate = {
  annualizedYield: 0.22,
  ask: 1.3,
  assignmentQuality: "good",
  bid: 1.2,
  breakeven: 188.75,
  contractSymbol: "AAPL260821P00190000",
  delta: -0.28,
  distanceFromSpotPct: 0.05,
  dte: 49,
  expirationDate: "2026-08-21",
  impliedVolatility: 0.31,
  liquidityQuality: "good",
  midpoint: 1.25,
  openInterest: 300,
  optionType: "put",
  premiumYield: 0.0065,
  rank: 1,
  score: 82,
  scoreBreakdown: {
    deltaFit: 80,
    dteFit: 84,
    eventRisk: 90,
    liquidity: 86,
    technicalFit: 81,
    volatilityRisk: 78,
    yield: 83,
  },
  spread: 0.1,
  spreadPctOfMid: 0.08,
  strike: 190,
  theta: -0.04,
  volume: 120,
  warnings: [],
} as WheelCandidate;

const spread = {
  annualizedReturnOnRisk: 0.28,
  breakeven: 188.75,
  definedRiskQuality: "good",
  distanceFromSpotPct: 0.05,
  dte: 49,
  expirationDate: "2026-08-21",
  id: "AAPL-260821-190-180-put",
  impliedVolatility: 0.32,
  liquidityQuality: "good",
  longLeg: {
    ask: 0.8,
    bid: 0.7,
    contractSymbol: "AAPL260821P00180000",
    delta: -0.18,
    impliedVolatility: 0.33,
    midpoint: 0.75,
    openInterest: 260,
    strike: 180,
    theta: -0.03,
    volume: 80,
  },
  maxLoss: 875,
  netCredit: 1.25,
  netDelta: -0.1,
  netTheta: -0.01,
  openInterest: 260,
  optionType: "put",
  rank: 2,
  returnOnRisk: 0.14,
  score: 78,
  scoreBreakdown: {
    deltaFit: 78,
    dteFit: 80,
    eventRisk: 88,
    liquidity: 82,
    technicalFit: 79,
    volatilityRisk: 76,
    yield: 81,
  },
  shortDelta: -0.28,
  shortLeg: {
    ask: 2.05,
    bid: 1.95,
    contractSymbol: "AAPL260821P00190000",
    delta: -0.28,
    impliedVolatility: 0.31,
    midpoint: 2,
    openInterest: 300,
    strike: 190,
    theta: -0.04,
    volume: 120,
  },
  spreadPctOfCredit: 0.08,
  strategy: "put_credit_spread",
  volume: 80,
  warnings: [],
  width: 10,
} as VerticalSpreadCandidate;

const analysisContext = {
  dataFreshness: {
    asOf: "2026-07-23T18:00:00.000Z",
    cacheStatus: "stale",
    feed: "opra",
    nextSuggestedRefreshAt: null,
    source: "runtime_cache",
  },
  filters: { dteMin: 20 },
  persona: {
    id: "balanced_wheel",
    motto: "Balanced",
    name: "Balanced",
  },
  source: "wheel_dashboard",
  ticker: "AAPL",
  underlying: {
    asOf: "2026-07-23T18:00:00.000Z",
    movingAverages: { ma20: 200, ma50: 195, ma200: 180 },
    price: 201.25,
    rsi14: 55,
    symbol: "AAPL",
    trend: "neutral",
  },
} as CandidateAnalysisContext;

const filing = {
  accession_number: "0001067983-26-000001",
  filing_date: "2026-07-23",
  fiscal_period: "Q2",
  fiscal_year: 2026,
  form_type: "10-Q",
  id: "filing-brkb",
  primary_document_url:
    "https://www.sec.gov/Archives/edgar/data/1067983/fixture.htm",
  report_date: "2026-06-30",
  sec_url:
    "https://www.sec.gov/Archives/edgar/data/1067983/fixture.htm",
} satisfies SignalScribeFiling;

const filingAnalysis = {
  accession_number: filing.accession_number,
  business_summary: "A diversified operating and investment company.",
  catalysts: ["Insurance underwriting discipline"],
  created_at: "2026-07-23T18:00:00.000Z",
  financial_summary: ["Liquidity remains substantial"],
  form_type: "10-Q",
  id: "analysis-brkb",
  key_findings: ["Operating earnings remained resilient"],
  management_tone: "measured",
  quality_score: 91,
  red_flags: ["Equity portfolio concentration"],
  risk_score: 34,
  source_citations: [{ label: "SEC filing", url: filing.sec_url }],
  summary: "Deterministic filing analysis for accessibility verification.",
} satisfies SignalScribeAnalysis;

const walletAddress = "0x1111111111111111111111111111111111111111";
const walletProfile = {
  activity: [],
  closedPositions: [],
  dataFreshness: {
    asOf: "2026-07-23T18:00:00.000Z",
    cacheStatus: "fresh",
    cachedUntil: null,
    source: "polymarket",
  },
  openPositions: [],
  scores: {
    activityScore: 64,
    alphaDogScore: 78,
    edgeScore: 72,
    profitabilityScore: 81,
  },
  summary: {
    closedPositionCount: 4,
    concentrationRatio: 0.32,
    lastActivityAt: null,
    openCashPnl: 230,
    openPositionCount: 2,
    positiveClosedPositionRate: 0.75,
    realizedPnl: 840,
    recentActivityCount: 6,
    topMarketValue: 1_200,
    totalOpenValue: 2_500,
  },
  totalValue: 3_340,
  wallet: walletAddress,
} as TraderWalletProfile;

function positionSummary() {
  return {
    closedAt: null,
    contractsOpened: 1,
    contractsRemaining: 1,
    dataProvenance: {
      asOf: "2026-07-23T18:00:00.000Z",
      cacheSource: "runtime_cache",
      cacheStatus: "stale",
      feed: "opra",
      sourceMode: "live",
    },
    expirationDate: "2026-08-21",
    id: "position-1",
    lifecycle: null,
    netCredit: 1.25,
    notes: "Accessibility fixture",
    openedAt: "2026-07-20T12:00:00.000Z",
    source: "simulated",
    status: "open",
    strategyType: "short_put",
    symbol: "AAPL",
    underlyingPriceAtOpen: 201.25,
    valuation: {
      markStatus: "available",
      markToClose: 100,
      openExposure: 19_000,
      premiumRemaining: 125,
      unrealizedPnl: 25,
    },
  };
}

window.fetch = async (input) => {
  const request = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;

  if (request === "/api/account/positions") {
    return new Response(JSON.stringify({
      pages: {
        history: { items: [], nextCursor: null, total: 0 },
        open: { items: [positionSummary()], nextCursor: null, total: 1 },
      },
    }), { headers: { "content-type": "application/json" } });
  }

  if (request === "/api/account/positions/position-1") {
    return new Response(JSON.stringify({
      position: {
        ...positionSummary(),
        events: [],
        legs: [],
        nextEventCursor: null,
      },
    }), { headers: { "content-type": "application/json" } });
  }

  return new Response(JSON.stringify({
    error: {
      code: "UNEXPECTED_FIXTURE_REQUEST",
      message: `Unexpected fixture request: ${request}`,
    },
  }), {
    headers: { "content-type": "application/json" },
    status: 500,
  });
};

function FixtureApp() {
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [spreadOpen, setSpreadOpen] = useState(false);
  const [positionRequest, setPositionRequest] =
    useState<OpenPositionCandidateRequest | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);

  return (
    <main className="min-h-screen bg-[#080a0c] p-6 text-zinc-100">
      <h1 className="text-2xl font-semibold text-white">
        AD-015 overlay verification
      </h1>
      <div className="mt-6 flex flex-wrap gap-3">
        <button
          className="rounded-lg bg-emerald-300 px-4 py-2 text-black"
          onClick={() => setCandidateOpen(true)}
          type="button"
        >
          Open candidate details
        </button>
        <button
          className="rounded-lg bg-emerald-300 px-4 py-2 text-black"
          onClick={() => setSpreadOpen(true)}
          type="button"
        >
          Open spread details
        </button>
        <button
          className="rounded-lg bg-emerald-300 px-4 py-2 text-black"
          onClick={() =>
            setPositionRequest({
              candidate,
              candidateType: "contract",
              strategy: "short_put",
            })}
          type="button"
        >
          Open position form
        </button>
        <button
          className="rounded-lg bg-emerald-300 px-4 py-2 text-black"
          onClick={() => setWalletOpen(true)}
          type="button"
        >
          Open wallet profile
        </button>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Filing overlay</h2>
        <FilingAnalysisCards analyses={[filingAnalysis]} filings={[filing]} />
      </section>

      <section className="mt-8">
        <PaperPositionsPanel />
      </section>

      <CandidateDetailDrawer
        analysis={{ status: "idle" }}
        candidate={candidateOpen ? candidate : null}
        companyInsightState={{ data: null, error: null, status: "idle" }}
        onAnalyze={() => undefined}
        onClose={() => setCandidateOpen(false)}
        underlyingPrice={201.25}
      />
      <SpreadDetailDrawer
        analysis={{ status: "idle" }}
        candidate={spreadOpen ? spread : null}
        companyInsightState={{ data: null, error: null, status: "idle" }}
        onAnalyze={() => undefined}
        onClose={() => setSpreadOpen(false)}
      />
      <AddPositionModal
        analysisContext={analysisContext}
        onClose={() => setPositionRequest(null)}
        request={positionRequest}
      />
      <WalletDrawer
        loading={false}
        onClose={() => setWalletOpen(false)}
        profile={walletOpen ? walletProfile : null}
        wallet={walletOpen ? walletAddress : null}
      />
    </main>
  );
}

const root = document.querySelector("#root");

if (!root) {
  throw new Error("AD-015 browser fixture root is missing.");
}

createRoot(root).render(<FixtureApp />);
