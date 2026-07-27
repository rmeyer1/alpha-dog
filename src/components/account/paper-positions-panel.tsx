"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  legSnapshotFromSavedLeg,
  PositionLegSnapshotList,
} from "@/components/wheel-dashboard/position-leg-snapshot";
import { AccessibleOverlay } from "@/components/ui/accessible-overlay";
import { validateClosePositionInput } from "./paper-positions/close-validation";
import type { CloseSubmitState, DetailState, LoadState, PositionDetail, PositionEvent, PositionLifecycleSummary, PositionPage, PositionSummary, PositionTab, PositionsPayload } from "./paper-positions/contracts";
import { closeDateTimestamp, formatCompactDate, formatCount, formatCurrency, formatDate, formatNumber, labelize, positionKind, provenanceLabel, strategyLabel, todayInputDate } from "./paper-positions/formatting";
import { mergePositionEvents, reconcilePositionPages } from "./paper-positions/reconciliation";
import { usePaperPositionsRequestState } from "./paper-positions/request-state";
import { PositionStatusPill } from "./paper-positions/presentation";

export type { ClosePositionValidationResult } from "./paper-positions/close-validation";
export { lifecycleLabel } from "./paper-positions/formatting";
export { mergePositionRows, reconcilePositionPages } from "./paper-positions/reconciliation";
export { validateClosePositionInput } from "./paper-positions/close-validation";

const PAPER_ACCOUNT_REFRESH_EVENT = "paper-account:refresh";

function numberMetadata(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadata[key];
  const parsed = typeof value === "number" ? value : Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function stringMetadata(
  metadata: Record<string, unknown>,
  key: string,
) {
  const value = metadata[key];

  return typeof value === "string" && value.length > 0 ? value : null;
}

function LoadingState() {
  return (
    <div
      aria-atomic="true"
      className="flex min-h-36 items-center justify-center gap-2 text-sm text-zinc-400"
      role="status"
    >
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      Loading simulated positions
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      aria-atomic="true"
      className="rounded-lg border border-red-300/25 bg-red-300/10 p-4 text-sm text-red-100"
      role="alert"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p>{message}</p>
        </div>
        <button
          className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-red-200/30 bg-red-200/10 px-3 font-semibold transition hover:bg-red-200/15"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw className="size-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-white/15 bg-black/20 p-5">
      <p className="text-sm font-medium text-white">
        No simulated positions here yet.
      </p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        Open a candidate from the screener to start tracking paper positions.
      </p>
      <Link
        className="mt-4 inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200"
        href="/screeners"
      >
        Open screeners
      </Link>
    </div>
  );
}

function PositionMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-1 border-t border-white/10 py-3 sm:border-t-0 sm:border-l sm:px-4 first:sm:border-l-0">
      <dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt>
      <dd className="font-mono text-sm text-zinc-100">{value}</dd>
    </div>
  );
}

function DesktopPositionTable({
  onSelect,
  positions,
}: {
  onSelect: (position: PositionSummary) => void;
  positions: PositionSummary[];
}) {
  return (
    <div className="hidden overflow-x-auto lg:block">
      <table className="w-full min-w-[960px] border-collapse text-left text-sm">
        <thead className="border-b border-white/10 text-xs uppercase text-zinc-500">
          <tr>
            {[
              "Position",
              "Status",
              "Opened",
              "Exp.",
              "Qty",
              "Credit",
              "Value",
              "Unrealized",
              "Exposure",
            ].map((heading) => (
              <th className="px-3 py-3 font-medium" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <tr
              className="border-b border-white/10 text-zinc-100 hover:bg-white/[0.035]"
              key={position.id}
            >
              <td className="px-3 py-3">
                <button
                  className="grid text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                  onClick={() => onSelect(position)}
                  type="button"
                >
                  <span className="font-semibold text-white">
                    {position.symbol}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {strategyLabel(position.strategyType)} · {positionKind(position.source)} ·{" "}
                    {provenanceLabel(position.dataProvenance)}
                  </span>
                </button>
              </td>
              <td className="px-3 py-3">
                <PositionStatusPill
                  lifecycle={position.lifecycle}
                  status={position.status}
                />
              </td>
              <td className="px-3 py-3 font-mono text-xs">
                {formatCompactDate(position.openedAt)}
              </td>
              <td className="px-3 py-3 font-mono text-xs">
                {formatCompactDate(position.expirationDate)}
              </td>
              <td className="px-3 py-3 font-mono">
                {formatCount(position.contractsRemaining)} /{" "}
                {formatCount(position.contractsOpened)}
              </td>
              <td className="px-3 py-3 font-mono">
                {formatCurrency(position.netCredit)}
              </td>
              <td className="px-3 py-3 font-mono">
                {formatCurrency(position.valuation.markToClose)}
              </td>
              <td className="px-3 py-3 font-mono">
                {formatCurrency(position.valuation.unrealizedPnl)}
              </td>
              <td className="px-3 py-3 font-mono">
                {formatCurrency(position.valuation.openExposure)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MobilePositionCards({
  onSelect,
  positions,
}: {
  onSelect: (position: PositionSummary) => void;
  positions: PositionSummary[];
}) {
  return (
    <div className="grid gap-3 lg:hidden">
      {positions.map((position) => (
        <button
          className="rounded-lg border border-white/10 bg-black/20 p-4 text-left transition hover:border-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
          key={position.id}
          onClick={() => onSelect(position)}
          type="button"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-white">{position.symbol}</div>
              <div className="mt-1 text-xs text-zinc-500">
                {strategyLabel(position.strategyType)} · {positionKind(position.source)} ·{" "}
                {provenanceLabel(position.dataProvenance)}
              </div>
            </div>
            <PositionStatusPill
              lifecycle={position.lifecycle}
              status={position.status}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <PositionMetric label="Opened" value={formatDate(position.openedAt)} />
            <PositionMetric label="Exp." value={formatDate(position.expirationDate)} />
            <PositionMetric
              label="Qty"
              value={`${formatCount(position.contractsRemaining)} / ${formatCount(position.contractsOpened)}`}
            />
            <PositionMetric label="Credit" value={formatCurrency(position.netCredit)} />
            <PositionMetric
              label="Value"
              value={formatCurrency(position.valuation.markToClose)}
            />
            <PositionMetric
              label="Unrealized"
              value={formatCurrency(position.valuation.unrealizedPnl)}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

function PositionsList({
  activeTab,
  onSelect,
  positions,
}: {
  activeTab: PositionTab;
  onSelect: (position: PositionSummary) => void;
  positions: PositionSummary[];
}) {
  if (positions.length === 0) {
    return <EmptyState />;
  }

  return (
    <>
      <DesktopPositionTable onSelect={onSelect} positions={positions} />
      <MobilePositionCards onSelect={onSelect} positions={positions} />
      <p className="sr-only">
        Showing {positions.length} {activeTab === "open" ? "open" : "historical"} simulated positions.
      </p>
    </>
  );
}

function LoadMoreControl({
  error,
  isLoading,
  nextCursor,
  onLoadMore,
  scopeLabel,
}: {
  error?: string;
  isLoading: boolean;
  nextCursor: string | null;
  onLoadMore: () => void;
  scopeLabel: string;
}) {
  const isComplete = nextCursor == null && !error;
  const statusId = `load-more-${scopeLabel.replace(/\s+/g, "-")}-status`;

  return (
    <div className="mt-4 grid justify-items-center gap-2">
      <button
        aria-busy={isLoading}
        aria-describedby={statusId}
        aria-disabled={isLoading || isComplete}
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08] aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        onClick={() => {
          if (!isLoading && !isComplete) {
            onLoadMore();
          }
        }}
        type="button"
      >
        {isLoading ? <Loader2 className="size-4 animate-spin" /> : null}
        {isLoading
          ? `Loading more ${scopeLabel}`
          : error
            ? `Retry loading more ${scopeLabel}`
            : isComplete
              ? `All ${scopeLabel} loaded`
              : `Load more ${scopeLabel}`}
      </button>
      <p
        aria-live="polite"
        className={error ? "text-sm text-red-100" : "sr-only"}
        id={statusId}
      >
        {error ??
          (isLoading
            ? `Loading another page of ${scopeLabel}.`
            : isComplete
              ? `All ${scopeLabel} are loaded.`
              : `More ${scopeLabel} are available.`)}
      </p>
    </div>
  );
}

function EventHistory({ events }: { events: PositionEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">
        No event history available.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {events.map((event) => (
        <div
          className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
          key={event.id}
        >
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="font-medium text-white">{labelize(event.eventType)}</div>
            <div className="text-xs text-zinc-500">{formatDate(event.createdAt)}</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <PositionMetric
              label="Qty"
              value={event.quantity == null ? "Unavailable" : formatCount(event.quantity)}
            />
            <PositionMetric label="Price" value={formatCurrency(event.price)} />
            <PositionMetric label="Cash" value={formatCurrency(event.cashDelta)} />
            <PositionMetric label="Margin" value={formatCurrency(event.marginDelta)} />
            <PositionMetric
              label="Realized"
              value={formatCurrency(event.realizedPnlDelta)}
            />
          </div>
          <LifecycleEventDetails event={event} />
        </div>
      ))}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-xs font-medium uppercase text-zinc-500">
        {label}
      </div>
      <div className="mt-1 font-mono text-sm text-zinc-100">{value}</div>
    </div>
  );
}

export function lifecycleRows(lifecycle: PositionLifecycleSummary) {
  const metadata = lifecycle.metadata;

  if (lifecycle.outcome === "assigned") {
    return [
      ["Effective date", formatDate(lifecycle.effectiveAt)],
      ["Shares assigned", formatNumber(numberMetadata(metadata, "shares"))],
      ["Cost basis", formatCurrency(numberMetadata(metadata, "costBasis") ?? lifecycle.price)],
      ["Assignment cost", formatCurrency(numberMetadata(metadata, "assignmentCost"))],
      ["Cash impact", formatCurrency(lifecycle.cashDelta)],
      ["Margin used", formatCurrency(lifecycle.marginDelta)],
      [
        "Underlying at expiration",
        formatCurrency(numberMetadata(metadata, "underlyingPriceAtExpiration")),
      ],
    ];
  }

  if (lifecycle.outcome === "called_away") {
    return [
      ["Effective date", formatDate(lifecycle.effectiveAt)],
      ["Shares called away", formatNumber(numberMetadata(metadata, "shares"))],
      ["Call-away price", formatCurrency(numberMetadata(metadata, "calledAwayPrice") ?? lifecycle.price)],
      ["Call-away proceeds", formatCurrency(numberMetadata(metadata, "calledAwayProceeds") ?? lifecycle.cashDelta)],
      ["Cost basis", formatCurrency(numberMetadata(metadata, "costBasis"))],
      ["Cash impact", formatCurrency(lifecycle.cashDelta)],
      ["Realized P/L", formatCurrency(lifecycle.realizedPnlDelta)],
      [
        "Underlying at expiration",
        formatCurrency(numberMetadata(metadata, "underlyingPriceAtExpiration")),
      ],
      ["Source lot", stringMetadata(metadata, "sourceLotId") ?? "Unavailable"],
      ["Source position", stringMetadata(metadata, "sourcePositionId") ?? "Unavailable"],
      ["Remaining lot shares", formatNumber(numberMetadata(metadata, "remainingLotShares"))],
    ];
  }

  if (lifecycle.outcome === "expired_otm") {
    return [
      ["Effective date", formatDate(lifecycle.effectiveAt)],
      [
        "Underlying at expiration",
        formatCurrency(numberMetadata(metadata, "underlyingPriceAtExpiration")),
      ],
      ["Contracts expired", lifecycle.quantity == null ? "Unavailable" : formatCount(lifecycle.quantity)],
      ["Premium retained", formatCurrency(lifecycle.realizedPnlDelta)],
    ];
  }

  return [
    ["Effective date", formatDate(lifecycle.effectiveAt)],
    ["Reason", labelize(stringMetadata(metadata, "reason") ?? "manual_review")],
    ["Contracts needing review", lifecycle.quantity == null ? "Unavailable" : formatCount(lifecycle.quantity)],
    ["Notes", stringMetadata(metadata, "notes") ?? "Unavailable"],
  ];
}

function lifecycleCopy(lifecycle: PositionLifecycleSummary) {
  switch (lifecycle.outcome) {
    case "assigned":
      return {
        description: "Backend expiration processing assigned this short put into simulated shares. Review the cash and margin impact before taking the next paper-account action.",
        title: "Assigned",
      };
    case "called_away":
      return {
        description: "Backend lifecycle processing marked this covered call as called away. Review the related share and cash impact details below.",
        title: "Called away",
      };
    case "expired_otm":
      return {
        description: "Backend expiration processing closed this position as out of the money with premium retained.",
        title: "Expired OTM",
      };
    case "manual_review":
      return {
        description: "This outcome needs manual review. The position was not automatically resolved, so confirm the final result before relying on the account totals.",
        title: "Manual review required",
      };
  }
}

function LifecycleNotice({ position }: { position: PositionDetail }) {
  const lifecycle = position.lifecycle;

  if (!lifecycle) {
    if (!["assigned", "called_away", "manual_review"].includes(position.status)) {
      return null;
    }

    const fallbackTitle = position.status === "assigned"
      ? "Assigned"
      : position.status === "called_away"
        ? "Called away"
        : "Manual review required";
    const fallbackDescription = position.status === "assigned"
      ? "This position is marked assigned, but lifecycle event details are unavailable."
      : position.status === "called_away"
        ? "This position is marked called away, but lifecycle event details are unavailable."
        : "This position is flagged for manual review, but no lifecycle event details are available yet.";

    return (
      <div className="rounded-lg border border-red-300/25 bg-red-300/10 p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-100" />
          <div>
            <div className="text-sm font-semibold text-red-50">
              {fallbackTitle}
            </div>
            <p className="mt-1 text-sm leading-6 text-red-100/85">
              {fallbackDescription}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const copy = lifecycleCopy(lifecycle);
  const isManualReview = lifecycle.outcome === "manual_review";
  const isWarning = lifecycle.outcome === "assigned" ||
    lifecycle.outcome === "called_away";
  const tone = isManualReview
    ? "border-red-300/25 bg-red-300/10 text-red-100"
    : isWarning
      ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
      : "border-sky-300/25 bg-sky-300/10 text-sky-100";

  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex items-start gap-2">
        {lifecycle.outcome === "expired_otm" ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        )}
        <div>
          <div className="text-sm font-semibold">{copy.title}</div>
          <p className="mt-1 text-sm leading-6 opacity-85">
            {copy.description}
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {lifecycleRows(lifecycle).map(([label, value]) => (
          <DetailRow key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}

function LifecycleEventDetails({ event }: { event: PositionEvent }) {
  const metadata = event.metadata;
  const rows: [string, string][] = [];

  if (event.eventType === "assigned") {
    rows.push(
      ["Shares", formatNumber(numberMetadata(metadata, "shares"))],
      ["Cost basis", formatCurrency(numberMetadata(metadata, "costBasis"))],
      ["Assignment cost", formatCurrency(numberMetadata(metadata, "assignmentCost"))],
      [
        "Underlying at expiration",
        formatCurrency(numberMetadata(metadata, "underlyingPriceAtExpiration")),
      ],
    );
  }

  if (event.eventType === "expired") {
    rows.push(
      ["Outcome", labelize(stringMetadata(metadata, "outcome") ?? "expired")],
      [
        "Underlying at expiration",
        formatCurrency(numberMetadata(metadata, "underlyingPriceAtExpiration")),
      ],
    );
  }

  if (event.eventType === "manual_adjustment") {
    rows.push(
      ["Reason", labelize(stringMetadata(metadata, "reason") ?? "manual_review")],
      ["Notes", stringMetadata(metadata, "notes") ?? "Unavailable"],
    );
  }

  if (event.eventType === "called_away") {
    rows.push(
      ["Shares", formatNumber(numberMetadata(metadata, "shares"))],
      ["Call-away price", formatCurrency(numberMetadata(metadata, "calledAwayPrice"))],
      ["Call-away proceeds", formatCurrency(numberMetadata(metadata, "calledAwayProceeds"))],
      ["Cost basis", formatCurrency(numberMetadata(metadata, "costBasis"))],
      ["Stock P/L", formatCurrency(numberMetadata(metadata, "stockRealizedPnl"))],
      [
        "Underlying at expiration",
        formatCurrency(numberMetadata(metadata, "underlyingPriceAtExpiration")),
      ],
      ["Source lot", stringMetadata(metadata, "sourceLotId") ?? "Unavailable"],
    );
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <DetailRow key={label} label={label} value={value} />
      ))}
    </div>
  );
}

function defaultClosePrice(position: PositionDetail) {
  if (
    position.valuation.markToClose != null &&
    position.contractsRemaining > 0
  ) {
    return String(Number(
      (position.valuation.markToClose / position.contractsRemaining / 100)
        .toFixed(2),
    ));
  }

  return String(Number(position.netCredit.toFixed(2)));
}

function ClosePositionModal({
  onClose,
  onRefresh,
  onSuccess,
  position,
}: {
  onClose: () => void;
  onRefresh: () => void;
  onSuccess: (positionId: string) => void;
  position: PositionDetail | null;
}) {
  if (!position) {
    return null;
  }

  return (
    <ClosePositionForm
      key={position.id}
      onClose={onClose}
      onRefresh={onRefresh}
      onSuccess={onSuccess}
      position={position}
    />
  );
}

function ClosePositionForm({
  onClose,
  onRefresh,
  onSuccess,
  position,
}: {
  onClose: () => void;
  onRefresh: () => void;
  onSuccess: (positionId: string) => void;
  position: PositionDetail;
}) {
  const contractsInputRef = useRef<HTMLInputElement>(null);
  const [contracts, setContracts] = useState("1");
  const [closePrice, setClosePrice] = useState(() => defaultClosePrice(position));
  const [closedAt, setClosedAt] = useState(todayInputDate);
  const [notes, setNotes] = useState("");
  const [submitState, setSubmitState] =
    useState<CloseSubmitState>({ status: "idle" });

  const isSubmitting = submitState.status === "submitting";
  const isSuccess = submitState.status === "success";
  const parsedContracts = Number(contracts);
  const remainingAfter = Number.isInteger(parsedContracts)
    ? Math.max(position.contractsRemaining - parsedContracts, 0)
    : position.contractsRemaining;

  async function submitClose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting || isSuccess) {
      return;
    }

    const contractsToClose = Number(contracts);
    const parsedClosePrice = Number(closePrice);
    const validation = validateClosePositionInput({
      closedAt,
      closePrice,
      contracts,
      remainingContracts: position.contractsRemaining,
    });

    if (!validation.valid) {
      setSubmitState({
        message: validation.message,
        stale: validation.stale,
        status: "error",
      });
      return;
    }

    setSubmitState({ status: "submitting" });

    try {
      const response = await fetch(
        `/api/account/positions/${position.id}/close`,
        {
          body: JSON.stringify({
            closePrice: parsedClosePrice,
            closedAt: closeDateTimestamp(closedAt),
            contractsToClose,
            notes: notes.trim() || undefined,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const payload = await response.json().catch(() => null) as
        | { error?: { code?: string; message?: string } }
        | null;

      if (!response.ok) {
        const code = payload?.error?.code;

        setSubmitState({
          message: payload?.error?.message ?? "Unable to close this position.",
          stale: code === "SIMULATED_POSITION_ALREADY_CLOSED" ||
            code === "SIMULATED_POSITION_NOT_FOUND" ||
            code === "SIMULATED_CLOSE_QUANTITY_EXCEEDS_REMAINING",
          status: "error",
        });
        return;
      }

      setSubmitState({
        message: contractsToClose === position.contractsRemaining
          ? "Position fully closed."
          : "Partial close saved.",
        status: "success",
      });
      onSuccess(position.id);
    } catch {
      setSubmitState({
        message: "Unable to reach the close-position service.",
        status: "error",
      });
    }
  }

  return (
    <AccessibleOverlay
      className="z-[60] bg-black/75 backdrop-blur-sm"
      description="Enter the contracts, buyback price, close date, and optional notes for this simulated position. Press Escape to cancel."
      initialFocusRef={contractsInputRef}
      label="Close simulated position"
      onClose={onClose}
      priority={10}
    >
      <section className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl lg:top-1/2 lg:left-1/2 lg:bottom-auto lg:w-[520px] lg:max-w-[calc(100vw-64px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-200">
              Buyback
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal text-white">
              Close {position.symbol} {strategyLabel(position.strategyType)}
            </h2>
            <p className="mt-1 text-sm text-zinc-400">
              {formatCount(position.contractsRemaining)} contracts remaining
            </p>
          </div>
          <button
            aria-label="Close buyback modal"
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <form className="mt-5 grid gap-4" onSubmit={(event) => void submitClose(event)}>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1.5 text-sm" htmlFor="closeContracts">
              <span className="font-medium text-zinc-200">Contracts</span>
              <input
                className="h-10 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                id="closeContracts"
                max={position.contractsRemaining}
                min="1"
                onChange={(event) => setContracts(event.target.value)}
                ref={contractsInputRef}
                required
                step="1"
                type="number"
                value={contracts}
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="closePrice">
              <span className="font-medium text-zinc-200">Buyback price</span>
              <input
                className="h-10 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                id="closePrice"
                min="0"
                onChange={(event) => setClosePrice(event.target.value)}
                required
                step="0.01"
                type="number"
                value={closePrice}
              />
            </label>
            <label className="grid gap-1.5 text-sm" htmlFor="closedAt">
              <span className="font-medium text-zinc-200">Close date</span>
              <input
                className="h-10 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
                id="closedAt"
                onChange={(event) => setClosedAt(event.target.value)}
                required
                type="date"
                value={closedAt}
              />
            </label>
          </div>

          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-300">
            Remaining after close:{" "}
            <span className="font-mono text-white">
              {formatCount(remainingAfter)}
            </span>
          </div>

          <label className="grid gap-1.5 text-sm" htmlFor="closeNotes">
            <span className="font-medium text-zinc-200">Notes</span>
            <textarea
              className="min-h-20 resize-y rounded-md border border-white/10 bg-black/30 px-3 py-2 text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              id="closeNotes"
              maxLength={2000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
              value={notes}
            />
          </label>

          {submitState.status === "error" ? (
            <div
              aria-atomic="true"
              className="rounded-lg border border-red-300/25 bg-red-300/10 p-3 text-sm text-red-100"
              role="alert"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{submitState.message}</span>
                {submitState.stale ? (
                  <button
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-red-200/30 bg-red-200/10 px-3 font-semibold transition hover:bg-red-200/15"
                    onClick={onRefresh}
                    type="button"
                  >
                    <RefreshCw className="size-4" />
                    Refresh
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {submitState.status === "success" ? (
            <p
              aria-atomic="true"
              className="inline-flex items-center gap-2 text-sm text-emerald-100"
              role="status"
            >
              <CheckCircle2 className="size-4" />
              {submitState.message}
            </p>
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
              {isSubmitting ? "Saving" : isSuccess ? "Saved" : "Save close"}
            </button>
          </div>
        </form>
      </section>
    </AccessibleOverlay>
  );
}

function PositionDetailDrawer({
  detailState,
  onLoadMoreEvents,
  onRequestClose,
  onClose,
}: {
  detailState: DetailState;
  onLoadMoreEvents: () => void;
  onRequestClose: (position: PositionDetail) => void;
  onClose: () => void;
}) {
  if (detailState.status === "idle") {
    return null;
  }

  const title = detailState.status === "ready"
    ? `${detailState.data.symbol} ${strategyLabel(detailState.data.strategyType)}`
    : "Position detail";

  return (
    <AccessibleOverlay
      description="Review the simulated position valuation, saved legs, and lifecycle events. Press Escape to close."
      label="Simulated position detail"
      onClose={onClose}
    >
      <section className="absolute inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-xl border border-white/10 bg-[#151718] p-4 shadow-2xl lg:top-1/2 lg:left-1/2 lg:bottom-auto lg:w-[720px] lg:max-w-[calc(100vw-64px)] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:rounded-xl lg:p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase text-emerald-200">
              Simulated position
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-normal text-white">
              {title}
            </h2>
          </div>
          <button
            aria-label="Close position detail"
            className="flex size-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08]"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {detailState.status === "loading" ? (
          <LoadingState />
        ) : null}
        {detailState.status === "error" ? (
          <div className="mt-5">
            <ErrorState message={detailState.message} onRetry={onClose} />
          </div>
        ) : null}
        {detailState.status === "ready" ? (
          <PositionDetailContent
            eventError={detailState.eventError}
            eventsLoading={detailState.eventsLoading ?? false}
            onLoadMoreEvents={onLoadMoreEvents}
            onRequestClose={() => onRequestClose(detailState.data)}
            position={detailState.data}
          />
        ) : null}
      </section>
    </AccessibleOverlay>
  );
}

function PositionDetailContent({
  eventError,
  eventsLoading,
  onLoadMoreEvents,
  onRequestClose,
  position,
}: {
  eventError?: string;
  eventsLoading: boolean;
  onLoadMoreEvents: () => void;
  onRequestClose: () => void;
  position: PositionDetail;
}) {
  const legSnapshots = position.legs.map(legSnapshotFromSavedLeg);
  const canClose = ["open", "partially_closed"].includes(position.status) &&
    position.contractsRemaining > 0;

  return (
    <div className="mt-5 grid gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <PositionStatusPill
            lifecycle={position.lifecycle}
            status={position.status}
          />
          <span className="inline-flex rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-zinc-200">
            {positionKind(position.source)}
          </span>
          <span
            className={position.dataProvenance.sourceMode === "demo"
              ? "inline-flex rounded-md border border-amber-300/25 bg-amber-300/10 px-2 py-1 text-xs font-semibold text-amber-100"
              : "inline-flex rounded-md border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-xs font-semibold text-cyan-100"}
          >
            {provenanceLabel(position.dataProvenance)}
          </span>
        </div>
        {canClose ? (
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200"
            onClick={onRequestClose}
            type="button"
          >
            Close position
          </button>
        ) : null}
      </div>

      <LifecycleNotice position={position} />

      <dl className="grid sm:grid-cols-3">
        <PositionMetric label="Opened" value={formatDate(position.openedAt)} />
        <PositionMetric label="Expiration" value={formatDate(position.expirationDate)} />
        <PositionMetric
          label="Contracts"
          value={`${formatCount(position.contractsRemaining)} / ${formatCount(position.contractsOpened)}`}
        />
        <PositionMetric label="Net credit" value={formatCurrency(position.netCredit)} />
        <PositionMetric
          label="Underlying"
          value={formatCurrency(position.underlyingPriceAtOpen)}
        />
        <PositionMetric label="Open exposure" value={formatCurrency(position.valuation.openExposure)} />
      </dl>

      <dl className="grid sm:grid-cols-3">
        <PositionMetric
          label="Candidate as of"
          value={formatDate(position.dataProvenance.asOf)}
        />
        <PositionMetric
          label="Mark to close"
          value={formatCurrency(position.valuation.markToClose)}
        />
        <PositionMetric
          label="Premium remaining"
          value={formatCurrency(position.valuation.premiumRemaining)}
        />
        <PositionMetric
          label="Unrealized P/L"
          value={formatCurrency(position.valuation.unrealizedPnl)}
        />
      </dl>

      {position.notes ? (
        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs font-medium uppercase text-zinc-500">Notes</div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">{position.notes}</p>
        </div>
      ) : null}

      <div>
        <div className="mb-2 text-sm font-medium text-white">Legs</div>
        <PositionLegSnapshotList defaultOpen legs={legSnapshots} />
      </div>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-white">
          <Clock3 className="size-4 text-emerald-200" />
          Events
        </div>
        <EventHistory events={position.events} />
        {position.events.length > 0 ? (
          <LoadMoreControl
            error={eventError}
            isLoading={eventsLoading}
            nextCursor={position.nextEventCursor}
            onLoadMore={onLoadMoreEvents}
            scopeLabel="position events"
          />
        ) : null}
      </div>
    </div>
  );
}

export function PaperPositionsPanel() {
  const [activeTab, setActiveTab] = useState<PositionTab>("open");
  const [{ detail: detailState, positions: loadState }, dispatchRequest] =
    usePaperPositionsRequestState();
  const setLoadState = (next: LoadState | ((current: LoadState) => LoadState)) => {
    if (typeof next === "function") {
      dispatchRequest({ type: "positions/update", update: next });
    } else {
      dispatchRequest({ state: next, type: "positions/received" });
    }
  };
  const setDetailState = (next: DetailState | ((current: DetailState) => DetailState)) => {
    if (typeof next === "function") {
      dispatchRequest({ type: "detail/update", update: next });
    } else {
      dispatchRequest({ state: next, type: "detail/received" });
    }
  };
  const [closePosition, setClosePosition] = useState<PositionDetail | null>(null);
  const closeTriggerRef = useRef<HTMLElement | null>(null);

  async function fetchPositions(): Promise<LoadState> {
    try {
      const response = await fetch("/api/account/positions", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as
        | (Partial<PositionsPayload> & {
          error?: { code?: string; message?: string };
        })
        | null;

      if (
        !response.ok ||
        !payload?.pages?.open ||
        !payload.pages.history
      ) {
        return {
          message: payload?.error?.message ?? "Unable to load simulated positions.",
          status: "error",
        };
      }

      return {
        announcement: "Loaded the first page of open and historical positions.",
        data: {
          pages: {
            history: payload.pages.history,
            open: payload.pages.open,
          },
        },
        pageError: {},
        pageLoading: null,
        status: "ready",
      };
    } catch {
      return {
        message: "Unable to reach the simulated positions service.",
        status: "error",
      };
    }
  }

  async function loadPositions() {
    dispatchRequest({ type: "positions/loading" });
    setLoadState(await fetchPositions());
  }

  async function loadMorePositions(scope: PositionTab) {
    if (loadState.status !== "ready" || loadState.pageLoading) {
      return;
    }

    const cursor = loadState.data.pages[scope].nextCursor;

    if (!cursor) {
      return;
    }

    dispatchRequest({ scope, type: "positions/page-loading" });

    try {
      const cursorName = scope === "open" ? "openCursor" : "historyCursor";
      const url = new URL("/api/account/positions", window.location.origin);
      url.searchParams.set("scope", scope);
      url.searchParams.set(cursorName, cursor);
      const response = await fetch(`${url.pathname}${url.search}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as
        | {
          error?: { code?: string; message?: string };
          pages?: Partial<Record<PositionTab, PositionPage>>;
        }
        | null;

      if (
        response.status === 409 &&
        payload?.error?.code === "STALE_POSITION_CURSOR"
      ) {
        const refreshed = await fetchPositions();

        if (refreshed.status === "ready") {
          setLoadState({
            ...refreshed,
            announcement: "Positions changed while paging, so the list was refreshed.",
          });
        } else {
          setLoadState(refreshed);
        }
        return;
      }

      const page = payload?.pages?.[scope];

      if (!response.ok || !page) {
        setLoadState((current) =>
          current.status === "ready"
            ? {
              ...current,
              announcement: "",
              pageError: {
                ...current.pageError,
                [scope]: payload?.error?.message ??
                  `Unable to load more ${scope} positions.`,
              },
              pageLoading: null,
            }
            : current
        );
        return;
      }

      setLoadState((current) => {
        if (current.status !== "ready") {
          return current;
        }

        const previousCount = current.data.pages[scope].items.length;
        const pages = reconcilePositionPages(current.data.pages, scope, page);
        const added = pages[scope].items.length - previousCount;

        return {
          ...current,
          announcement: added > 0
            ? `Loaded ${added} more ${scope === "open" ? "open" : "historical"} positions.`
            : `No additional ${scope === "open" ? "open" : "historical"} positions were added.`,
          data: { pages },
          pageError: { ...current.pageError, [scope]: undefined },
          pageLoading: null,
        };
      });
    } catch {
      setLoadState((current) =>
        current.status === "ready"
          ? {
            ...current,
            announcement: "",
            pageError: {
              ...current.pageError,
              [scope]: `Unable to reach the ${scope} position service.`,
            },
            pageLoading: null,
          }
          : current
      );
    }
  }

  async function fetchPositionDetail(
    positionId: string,
    eventCursor?: string,
  ): Promise<DetailState> {
    try {
      const url = new URL(
        `/api/account/positions/${positionId}`,
        window.location.origin,
      );

      if (eventCursor) {
        url.searchParams.set("eventCursor", eventCursor);
      }

      const response = await fetch(`${url.pathname}${url.search}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as
        | {
          error?: { code?: string; message?: string };
          position?: PositionDetail;
        }
        | null;

      if (!response.ok || !payload?.position) {
        return {
          code: payload?.error?.code,
          message: payload?.error?.message ?? "Unable to load position detail.",
          status: "error",
        };
      }

      return {
        data: {
          ...payload.position,
          nextEventCursor: payload.position.nextEventCursor ?? null,
        },
        status: "ready",
      };
    } catch {
      return {
        message: "Unable to reach the position detail service.",
        status: "error",
      };
    }
  }

  async function openDetail(position: PositionSummary) {
    dispatchRequest({ id: position.id, type: "detail/loading" });
    setDetailState(await fetchPositionDetail(position.id));
  }

  async function loadMoreEvents() {
    if (
      detailState.status !== "ready" ||
      detailState.eventsLoading ||
      !detailState.data.nextEventCursor
    ) {
      return;
    }

    const currentDetail = detailState.data;
    setDetailState({
      ...detailState,
      eventError: undefined,
      eventsLoading: true,
    });
    const next = await fetchPositionDetail(
      currentDetail.id,
      currentDetail.nextEventCursor ?? undefined,
    );

    if (next.status !== "ready") {
      if (next.status === "error" && next.code === "STALE_EVENT_CURSOR") {
        setDetailState(await fetchPositionDetail(currentDetail.id));
        return;
      }

      setDetailState({
        data: currentDetail,
        eventError: next.status === "error"
          ? next.message
          : "Unable to load more position events.",
        eventsLoading: false,
        status: "ready",
      });
      return;
    }

    setDetailState({
      data: {
        ...currentDetail,
        events: mergePositionEvents(currentDetail.events, next.data.events),
        nextEventCursor: next.data.nextEventCursor,
      },
      eventsLoading: false,
      status: "ready",
    });
  }

  function closeDetail() {
    dispatchRequest({ type: "detail/closed" });
    closeClosePositionModal();
  }

  function requestClosePosition(position: PositionDetail) {
    const activeElement = document.activeElement;
    closeTriggerRef.current = activeElement instanceof HTMLElement
      ? activeElement
      : null;
    setClosePosition(position);
  }

  function closeClosePositionModal() {
    setClosePosition(null);
    window.requestAnimationFrame(() => {
      closeTriggerRef.current?.focus();
      closeTriggerRef.current = null;
    });
  }

  async function refreshPositionContext(positionId: string) {
    const [nextPositions, nextDetail] = await Promise.all([
      fetchPositions(),
      fetchPositionDetail(positionId),
    ]);

    setLoadState(nextPositions);
    setDetailState(nextDetail);
    window.dispatchEvent(new Event(PAPER_ACCOUNT_REFRESH_EVENT));
  }

  async function refreshClosePositionContext(positionId: string) {
    await refreshPositionContext(positionId);

    if (closePosition?.id === positionId && detailState.status === "ready") {
      const nextDetail = await fetchPositionDetail(positionId);
      setClosePosition(nextDetail.status === "ready" ? nextDetail.data : null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialPositions() {
      const nextState = await fetchPositions();

      if (!cancelled) {
        dispatchRequest({ state: nextState, type: "positions/received" });
      }
    }

    void loadInitialPositions();

    return () => {
      cancelled = true;
    };
  }, [dispatchRequest]);

  const positions = loadState.status === "ready"
    ? loadState.data.pages[activeTab].items
    : [];
  const openCount = loadState.status === "ready"
    ? loadState.data.pages.open.total
    : 0;
  const historyCount = loadState.status === "ready"
    ? loadState.data.pages.history.total
    : 0;
  const activePage = loadState.status === "ready"
    ? loadState.data.pages[activeTab]
    : null;

  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-emerald-200">
            Positions
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
            Simulated position ledger
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Review open and historical paper positions without leaving the
            account page.
          </p>
        </div>
        {loadState.status === "ready" ? (
          <button
            aria-label="Refresh simulated positions"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08]"
            onClick={() => void loadPositions()}
            type="button"
          >
            <RefreshCw className="size-4" />
            Refresh
          </button>
        ) : null}
      </div>

      <div className="mb-5 inline-flex rounded-lg border border-white/10 bg-black/20 p-1">
        <button
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            activeTab === "open"
              ? "bg-emerald-300 text-black"
              : "text-zinc-300 hover:bg-white/[0.06]"
          }`}
          onClick={() => setActiveTab("open")}
          type="button"
        >
          Open ({openCount})
        </button>
        <button
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            activeTab === "history"
              ? "bg-emerald-300 text-black"
              : "text-zinc-300 hover:bg-white/[0.06]"
          }`}
          onClick={() => setActiveTab("history")}
          type="button"
        >
          History ({historyCount})
        </button>
      </div>

      {loadState.status === "loading" ? <LoadingState /> : null}
      {loadState.status === "error" ? (
        <ErrorState
          message={loadState.message}
          onRetry={() => void loadPositions()}
        />
      ) : null}
      {loadState.status === "ready" ? (
        <>
          <PositionsList
            activeTab={activeTab}
            onSelect={(position) => void openDetail(position)}
            positions={positions}
          />
          {positions.length > 0 && activePage ? (
            <LoadMoreControl
              error={loadState.pageError[activeTab]}
              isLoading={loadState.pageLoading === activeTab}
              nextCursor={activePage.nextCursor}
              onLoadMore={() => void loadMorePositions(activeTab)}
              scopeLabel={activeTab === "open"
                ? "open positions"
                : "historical positions"}
            />
          ) : null}
          <p aria-atomic="true" className="sr-only" role="status">
            {loadState.announcement}
          </p>
        </>
      ) : null}

      <PositionDetailDrawer
        detailState={detailState}
        onLoadMoreEvents={() => void loadMoreEvents()}
        onClose={closeDetail}
        onRequestClose={requestClosePosition}
      />

      <ClosePositionModal
        onClose={closeClosePositionModal}
        onRefresh={() => {
          if (closePosition) {
            void refreshClosePositionContext(closePosition.id);
          }
        }}
        onSuccess={(positionId) => void refreshPositionContext(positionId)}
        position={closePosition}
      />
    </section>
  );
}
