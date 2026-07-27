"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { AccessibleOverlay } from "@/components/ui/accessible-overlay";
import type { SimulatedPositionInput } from "@/lib/account/simulated-positions";
import type { WheelCompanyStrategy } from "@/lib/wheel/types";
import {
  contractValue,
  formatCurrency,
} from "./formatters";
import {
  legSnapshotFromSpreadLeg,
  PositionLegSnapshotList,
  type PositionLegSnapshotData,
} from "./position-leg-snapshot";
import type { CandidateAnalysisContext } from "./types";
import type { OpenPositionCandidateRequest } from "./candidate-results";

type SubmitStatus =
  | { status: "idle" }
  | { message: string; status: "error"; actionHref?: string; actionLabel?: string }
  | { positionId?: string; status: "success" }
  | { status: "submitting" };

type PositionFormValues = {
  contracts: string;
  notes: string;
  openedAt: string;
  openPrice: string;
  strategyType: WheelCompanyStrategy;
};

type PositionApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

const singleLegStrategies = [
  { label: "Cash-secured put", value: "short_put" },
  { label: "Covered call", value: "covered_call" },
] satisfies Array<{
  label: string;
  value: Extract<WheelCompanyStrategy, "covered_call" | "short_put">;
}>;

const spreadStrategies = [
  { label: "Put credit spread", value: "put_credit_spread" },
  { label: "Call credit spread", value: "call_credit_spread" },
] satisfies Array<{
  label: string;
  value: Extract<WheelCompanyStrategy, "call_credit_spread" | "put_credit_spread">;
}>;

function todayInputDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function decimalInput(value: number) {
  return String(Number(value.toFixed(2)));
}

function strategyLabel(strategy: WheelCompanyStrategy) {
  switch (strategy) {
    case "call_credit_spread":
      return "Call credit spread";
    case "covered_call":
      return "Covered call";
    case "put_credit_spread":
      return "Put credit spread";
    case "short_put":
      return "Cash-secured put";
  }
}

function defaultCredit(request: OpenPositionCandidateRequest) {
  return request.candidateType === "contract"
    ? request.candidate.midpoint
    : request.candidate.netCredit;
}

function strategyOptionsFor(request: OpenPositionCandidateRequest) {
  const optionType = request.candidate.optionType;
  const options = request.candidateType === "contract"
    ? singleLegStrategies
    : spreadStrategies;

  return options.filter((option) =>
    optionType === "put"
      ? option.value.includes("put")
      : option.value.includes("call"));
}

function defaultFormValues(
  request: OpenPositionCandidateRequest,
): PositionFormValues {
  return {
    contracts: "1",
    notes: "",
    openedAt: todayInputDate(),
    openPrice: decimalInput(defaultCredit(request)),
    strategyType: request.strategy,
  };
}

function accountActionHref() {
  if (typeof window === "undefined") {
    return "/account?next=%2Fscreeners";
  }

  const next = `${window.location.pathname}${window.location.search}`;
  const params = new URLSearchParams({ next });

  return `/account?${params.toString()}`;
}

export function submitErrorState(
  payload: PositionApiErrorPayload | null,
  status: number,
): SubmitStatus {
  const code = payload?.error?.code;
  const message = payload?.error?.message ?? "Unable to save this position.";

  if (status === 401 || code === "UNAUTHENTICATED") {
    return {
      actionHref: accountActionHref(),
      actionLabel: "Sign in",
      message,
      status: "error",
    };
  }

  if (status === 403 || code === "PROFILE_INCOMPLETE") {
    return {
      actionHref: accountActionHref(),
      actionLabel: "Complete profile",
      message,
      status: "error",
    };
  }

  return { message, status: "error" };
}

function formError(message: string): SubmitStatus {
  return { message, status: "error" };
}

function asSnapshot(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function candidateDataProvenance(
  analysisContext: CandidateAnalysisContext,
): SimulatedPositionInput["dataProvenance"] {
  const freshness = analysisContext.dataFreshness;

  return {
    asOf: freshness.asOf,
    cacheSource:
      freshness.source ?? (freshness.feed === "demo" ? "demo" : "live"),
    cacheStatus: freshness.cacheStatus,
    feed: freshness.feed,
    sourceMode: freshness.feed === "demo" ? "demo" : "live",
  };
}

export function buildSimulatedPositionInput({
  analysisContext,
  contracts,
  notes,
  openedAt,
  openPrice,
  request,
  strategyType,
}: {
  analysisContext: CandidateAnalysisContext;
  contracts: number;
  notes: string;
  openedAt: string;
  openPrice: number;
  request: OpenPositionCandidateRequest;
  strategyType: WheelCompanyStrategy;
}): SimulatedPositionInput {
  if (request.candidateType === "contract") {
    const candidate = request.candidate;

    return {
      candidateSnapshot: asSnapshot({
        candidate,
        dataFreshness: analysisContext.dataFreshness,
        persona: analysisContext.persona,
        source: analysisContext.source,
      }),
      contracts,
      dataProvenance: candidateDataProvenance(analysisContext),
      expirationDate: candidate.expirationDate,
      legs: [{
        askPrice: candidate.ask,
        bidPrice: candidate.bid,
        contractSymbol: candidate.contractSymbol,
        currentMark: candidate.midpoint,
        delta: candidate.delta ?? undefined,
        expirationDate: candidate.expirationDate,
        impliedVolatility: candidate.impliedVolatility ?? undefined,
        midPrice: candidate.midpoint,
        openInterest: candidate.openInterest ?? undefined,
        openPrice,
        optionType: candidate.optionType,
        side: "short",
        snapshot: asSnapshot(candidate),
        strike: candidate.strike,
        theta: candidate.theta ?? undefined,
        volume: candidate.volume ?? undefined,
      }],
      netCredit: openPrice,
      notes: notes.trim() || undefined,
      openedAt,
      strategyType,
      symbol: analysisContext.ticker,
      underlyingPriceAtOpen: analysisContext.underlying.price,
    };
  }

  const candidate = request.candidate;

  return {
    candidateSnapshot: asSnapshot({
      candidate,
      dataFreshness: analysisContext.dataFreshness,
      persona: analysisContext.persona,
      source: analysisContext.source,
    }),
    contracts,
    dataProvenance: candidateDataProvenance(analysisContext),
    expirationDate: candidate.expirationDate,
    legs: [
      {
        askPrice: candidate.shortLeg.ask,
        bidPrice: candidate.shortLeg.bid,
        contractSymbol: candidate.shortLeg.contractSymbol,
        currentMark: candidate.shortLeg.midpoint,
        delta: candidate.shortLeg.delta ?? undefined,
        expirationDate: candidate.expirationDate,
        impliedVolatility: candidate.shortLeg.impliedVolatility ?? undefined,
        legIndex: 0,
        midPrice: candidate.shortLeg.midpoint,
        openInterest: candidate.shortLeg.openInterest ?? undefined,
        openPrice: candidate.shortLeg.midpoint,
        optionType: candidate.optionType,
        side: "short",
        snapshot: asSnapshot(candidate.shortLeg),
        strike: candidate.shortLeg.strike,
        theta: candidate.shortLeg.theta ?? undefined,
        volume: candidate.shortLeg.volume ?? undefined,
      },
      {
        askPrice: candidate.longLeg.ask,
        bidPrice: candidate.longLeg.bid,
        contractSymbol: candidate.longLeg.contractSymbol,
        currentMark: candidate.longLeg.midpoint,
        delta: candidate.longLeg.delta ?? undefined,
        expirationDate: candidate.expirationDate,
        impliedVolatility: candidate.longLeg.impliedVolatility ?? undefined,
        legIndex: 1,
        midPrice: candidate.longLeg.midpoint,
        openInterest: candidate.longLeg.openInterest ?? undefined,
        openPrice: candidate.longLeg.midpoint,
        optionType: candidate.optionType,
        side: "long",
        snapshot: asSnapshot(candidate.longLeg),
        strike: candidate.longLeg.strike,
        theta: candidate.longLeg.theta ?? undefined,
        volume: candidate.longLeg.volume ?? undefined,
      },
    ],
    netCredit: openPrice,
    notes: notes.trim() || undefined,
    openedAt,
    strategyType,
    symbol: analysisContext.ticker,
    underlyingPriceAtOpen: analysisContext.underlying.price,
  };
}

function candidateSummary(request: OpenPositionCandidateRequest) {
  if (request.candidateType === "contract") {
    const candidate = request.candidate;

    return {
      context: `${candidate.expirationDate} · ${candidate.dte} DTE · ${candidate.contractSymbol}`,
      priceContext: `Bid/ask ${formatCurrency(candidate.bid)}/${formatCurrency(candidate.ask)}`,
      title: `${formatCurrency(candidate.strike)} ${candidate.optionType.toUpperCase()}`,
    };
  }

  const candidate = request.candidate;

  return {
    context: `${candidate.expirationDate} · ${candidate.dte} DTE · ${candidate.id}`,
    priceContext: `Leg mids ${formatCurrency(candidate.shortLeg.midpoint)}/${formatCurrency(candidate.longLeg.midpoint)}`,
    title: `${formatCurrency(candidate.shortLeg.strike)} / ${formatCurrency(candidate.longLeg.strike)}`,
  };
}

function legSnapshotsForRequest(
  request: OpenPositionCandidateRequest,
  quantity: number | null,
): PositionLegSnapshotData[] {
  if (request.candidateType === "contract") {
    const candidate = request.candidate;

    return [{
      askPrice: candidate.ask,
      bidPrice: candidate.bid,
      contractSymbol: candidate.contractSymbol,
      delta: candidate.delta,
      expirationDate: candidate.expirationDate,
      impliedVolatility: candidate.impliedVolatility,
      midPrice: candidate.midpoint,
      openInterest: candidate.openInterest,
      openPrice: candidate.midpoint,
      optionType: candidate.optionType,
      quantity,
      side: "short",
      strike: candidate.strike,
      theta: candidate.theta,
      volume: candidate.volume,
    }];
  }

  const candidate = request.candidate;

  return [
    {
      ...legSnapshotFromSpreadLeg({
        expirationDate: candidate.expirationDate,
        leg: candidate.shortLeg,
        optionType: candidate.optionType,
        side: "short",
      }),
      quantity,
    },
    {
      ...legSnapshotFromSpreadLeg({
        expirationDate: candidate.expirationDate,
        leg: candidate.longLeg,
        optionType: candidate.optionType,
        side: "long",
      }),
      quantity,
    },
  ];
}

export function AddPositionModal({
  analysisContext,
  onClose,
  request,
}: {
  analysisContext: CandidateAnalysisContext;
  onClose: () => void;
  request: OpenPositionCandidateRequest | null;
}) {
  if (!request) {
    return null;
  }

  return (
    <AddPositionModalContent
      analysisContext={analysisContext}
      key={`${request.candidateType}-${request.candidateType === "contract" ? request.candidate.contractSymbol : request.candidate.id}`}
      onClose={onClose}
      request={request}
    />
  );
}

function AddPositionModalContent({
  analysisContext,
  onClose,
  request,
}: {
  analysisContext: CandidateAnalysisContext;
  onClose: () => void;
  request: OpenPositionCandidateRequest;
}) {
  const strategyInputRef = useRef<HTMLSelectElement>(null);
  const [values, setValues] = useState<PositionFormValues>(() =>
    defaultFormValues(request));
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>({ status: "idle" });

  const summary = candidateSummary(request);
  const isSubmitting = submitStatus.status === "submitting";
  const isSuccess = submitStatus.status === "success";
  const strategyOptions = strategyOptionsFor(request);
  const priceLabel = request.candidateType === "contract"
    ? "Open price"
    : "Net credit";
  const quantity = Number(values.contracts);
  const legSnapshots = legSnapshotsForRequest(
    request,
    Number.isInteger(quantity) && quantity > 0 ? quantity : null,
  );

  async function submitPosition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const contracts = Number(values.contracts);
    const openPrice = Number(values.openPrice);

    if (!Number.isInteger(contracts) || contracts <= 0) {
      setSubmitStatus(formError("Contracts must be a whole number above zero."));
      return;
    }

    if (!Number.isFinite(openPrice) || openPrice <= 0) {
      setSubmitStatus(formError(`${priceLabel} must be greater than zero.`));
      return;
    }

    if (!values.openedAt) {
      setSubmitStatus(formError("Open date is required."));
      return;
    }

    setSubmitStatus({ status: "submitting" });

    const body = buildSimulatedPositionInput({
      analysisContext,
      contracts,
      notes: values.notes,
      openedAt: values.openedAt,
      openPrice,
      request,
      strategyType: values.strategyType,
    });

    try {
      const response = await fetch("/api/account/positions", {
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as
        | { position?: { id?: string } }
        | PositionApiErrorPayload
        | null;

      if (!response.ok) {
        setSubmitStatus(submitErrorState(
          payload as PositionApiErrorPayload | null,
          response.status,
        ));
        return;
      }

      setSubmitStatus({
        positionId: (payload as { position?: { id?: string } } | null)
          ?.position?.id,
        status: "success",
      });
    } catch {
      setSubmitStatus(formError("Unable to reach the position service."));
    }
  }

  return (
    <AccessibleOverlay
      description="Review the candidate snapshot and enter the simulated position details. Press Escape to close without saving."
      initialFocusRef={strategyInputRef}
      label="Open simulated position"
      onClose={onClose}
    >
      <section className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl lg:top-1/2 lg:left-1/2 lg:bottom-auto lg:w-[560px] lg:max-w-[calc(100vw-64px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-200">
              Simulated position
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal text-white">
              {strategyLabel(values.strategyType)}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {analysisContext.ticker.toUpperCase()} · {summary.title}
            </p>
          </div>
          <button
            aria-label="Close add position modal"
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 grid gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500">Contract</span>
            <span className="truncate text-right font-mono text-zinc-100">
              {summary.context}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-zinc-500">Prefill</span>
            <span className="text-right font-mono text-zinc-100">
              {contractValue(defaultCredit(request))} · {summary.priceContext}
            </span>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-sm font-medium text-white">
            Leg snapshot
          </div>
          <PositionLegSnapshotList
            defaultOpen={request.candidateType === "contract"}
            legs={legSnapshots}
          />
        </div>

        <form className="mt-5 grid gap-4" onSubmit={(event) => void submitPosition(event)}>
          <label className="grid gap-1.5 text-sm" htmlFor="positionStrategyType">
            <span className="font-medium text-zinc-200">Strategy type</span>
            <select
              className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              id="positionStrategyType"
              onChange={(event) =>
                setValues((current) =>
                  current
                    ? {
                        ...current,
                        strategyType: event.target.value as WheelCompanyStrategy,
                      }
                    : current)}
              value={values.strategyType}
              ref={strategyInputRef}
            >
              {strategyOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm" htmlFor="positionContracts">
              <span className="font-medium text-zinc-200">Contracts</span>
              <input
                className="h-10 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                id="positionContracts"
                min="1"
                onChange={(event) =>
                  setValues((current) =>
                    current ? { ...current, contracts: event.target.value } : current)}
                required
                step="1"
                type="number"
                value={values.contracts}
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="positionOpenPrice">
              <span className="font-medium text-zinc-200">{priceLabel}</span>
              <input
                className="h-10 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                id="positionOpenPrice"
                min="0.01"
                onChange={(event) =>
                  setValues((current) =>
                    current ? { ...current, openPrice: event.target.value } : current)}
                required
                step="0.01"
                type="number"
                value={values.openPrice}
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="positionOpenedAt">
              <span className="font-medium text-zinc-200">Open date</span>
              <input
                className="h-10 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                id="positionOpenedAt"
                onChange={(event) =>
                  setValues((current) =>
                    current ? { ...current, openedAt: event.target.value } : current)}
                required
                type="date"
                value={values.openedAt}
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm" htmlFor="positionNotes">
            <span className="font-medium text-zinc-200">Notes</span>
            <textarea
              className="min-h-20 resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              id="positionNotes"
              maxLength={2000}
              onChange={(event) =>
                setValues((current) =>
                  current ? { ...current, notes: event.target.value } : current)}
              placeholder="Optional"
              value={values.notes}
            />
          </label>

          {submitStatus.status === "error" ? (
            <div
              aria-atomic="true"
              className="rounded-lg border border-red-300/25 bg-red-300/10 p-3 text-sm text-red-100"
              role="alert"
            >
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p>{submitStatus.message}</p>
                  {submitStatus.actionHref && submitStatus.actionLabel ? (
                    <Link
                      className="mt-2 inline-flex min-h-9 items-center justify-center rounded-md border border-red-200/30 bg-red-200/10 px-3 text-sm font-semibold text-red-50 transition hover:bg-red-200/15"
                      href={submitStatus.actionHref}
                    >
                      {submitStatus.actionLabel}
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {isSuccess ? (
            <div
              aria-atomic="true"
              className="rounded-lg border border-emerald-300/25 bg-emerald-300/10 p-3 text-sm text-emerald-100"
              role="status"
            >
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                <div>
                  <p>Simulated position saved.</p>
                  <Link
                    className="mt-2 inline-flex min-h-9 items-center justify-center rounded-md border border-emerald-200/30 bg-emerald-200/10 px-3 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-200/15"
                    href="/account"
                  >
                    View account
                  </Link>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08]"
              onClick={onClose}
              type="button"
            >
              Close
            </button>
            <button
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isSubmitting || isSuccess}
              type="submit"
            >
              {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {isSubmitting ? "Saving" : isSuccess ? "Saved" : "Save position"}
            </button>
          </div>
        </form>
      </section>
    </AccessibleOverlay>
  );
}
