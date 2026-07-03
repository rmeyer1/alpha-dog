"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock3,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  legSnapshotFromSavedLeg,
  PositionLegSnapshotList,
  type SavedPositionLegSnapshot,
} from "@/components/wheel-dashboard/position-leg-snapshot";

type PositionValuation = {
  markStatus: "available" | "unavailable";
  markToClose: number | null;
  openExposure: number;
  premiumRemaining: number;
  unrealizedPnl: number | null;
};

type PositionSummary = {
  closedAt: string | null;
  contractsOpened: number;
  contractsRemaining: number;
  expirationDate: string | null;
  id: string;
  netCredit: number;
  notes: string | null;
  openedAt: string;
  source: string;
  status: string;
  strategyType: string;
  symbol: string;
  underlyingPriceAtOpen: number | null;
  valuation: PositionValuation;
};

type PositionEvent = {
  cashDelta: number;
  createdAt: string;
  eventType: string;
  id: string;
  marginDelta: number;
  price: number | null;
  quantity: number | null;
  realizedPnlDelta: number;
};

type PositionDetail = PositionSummary & {
  events: PositionEvent[];
  legs: SavedPositionLegSnapshot[];
};

type PositionsPayload = {
  historyPositions: PositionSummary[];
  openPositions: PositionSummary[];
};

type LoadState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { data: PositionsPayload; status: "ready" };

type DetailState =
  | { status: "idle" }
  | { id: string; status: "loading" }
  | { message: string; status: "error" }
  | { data: PositionDetail; status: "ready" };

type PositionTab = "history" | "open";

function formatCurrency(value: number | null | undefined) {
  if (value == null) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatCompactDate(value: string | null | undefined) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  }).format(new Date(value));
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function labelize(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusTone(status: string) {
  if (["open", "partially_closed"].includes(status)) {
    return "border-emerald-300/25 bg-emerald-300/10 text-emerald-100";
  }

  if (["assigned", "called_away", "manual_review"].includes(status)) {
    return "border-amber-300/25 bg-amber-300/10 text-amber-100";
  }

  return "border-white/10 bg-white/[0.04] text-zinc-200";
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-md border px-2 py-1 text-xs font-semibold ${statusTone(status)}`}>
      {labelize(status)}
    </span>
  );
}

function strategyLabel(value: string) {
  return labelize(value);
}

function positionKind(value: string) {
  return value === "simulated" ? "Paper" : labelize(value);
}

function LoadingState() {
  return (
    <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-zinc-400">
      <Loader2 className="size-4 animate-spin" />
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
    <div className="rounded-lg border border-red-300/25 bg-red-300/10 p-4 text-sm text-red-100">
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
                    {strategyLabel(position.strategyType)} · {positionKind(position.source)}
                  </span>
                </button>
              </td>
              <td className="px-3 py-3">
                <StatusPill status={position.status} />
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
                {strategyLabel(position.strategyType)} · {positionKind(position.source)}
              </div>
            </div>
            <StatusPill status={position.status} />
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
            <PositionMetric
              label="Realized"
              value={formatCurrency(event.realizedPnlDelta)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function PositionDetailDrawer({
  detailState,
  onClose,
}: {
  detailState: DetailState;
  onClose: () => void;
}) {
  if (detailState.status === "idle") {
    return null;
  }

  const title = detailState.status === "ready"
    ? `${detailState.data.symbol} ${strategyLabel(detailState.data.strategyType)}`
    : "Position detail";

  return (
    <div
      aria-label="Simulated position detail"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
      role="dialog"
    >
      <button
        aria-label="Close position detail"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
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
          <PositionDetailContent position={detailState.data} />
        ) : null}
      </section>
    </div>
  );
}

function PositionDetailContent({ position }: { position: PositionDetail }) {
  const legSnapshots = position.legs.map(legSnapshotFromSavedLeg);

  return (
    <div className="mt-5 grid gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={position.status} />
        <span className="inline-flex rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs font-semibold text-zinc-200">
          {positionKind(position.source)}
        </span>
      </div>

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
      </div>
    </div>
  );
}

export function PaperPositionsPanel() {
  const [activeTab, setActiveTab] = useState<PositionTab>("open");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [detailState, setDetailState] = useState<DetailState>({ status: "idle" });

  async function fetchPositions(): Promise<LoadState> {
    try {
      const response = await fetch("/api/account/positions", {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as
        | (Partial<PositionsPayload> & { error?: { message?: string } })
        | null;

      if (!response.ok || !payload) {
        return {
          message: payload?.error?.message ?? "Unable to load simulated positions.",
          status: "error",
        };
      }

      return {
        data: {
          historyPositions: payload.historyPositions ?? [],
          openPositions: payload.openPositions ?? [],
        },
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
    setLoadState({ status: "loading" });
    setLoadState(await fetchPositions());
  }

  async function openDetail(position: PositionSummary) {
    setDetailState({ id: position.id, status: "loading" });

    try {
      const response = await fetch(`/api/account/positions/${position.id}`, {
        cache: "no-store",
      });
      const payload = await response.json().catch(() => null) as
        | { error?: { message?: string }; position?: PositionDetail }
        | null;

      if (!response.ok || !payload?.position) {
        setDetailState({
          message: payload?.error?.message ?? "Unable to load position detail.",
          status: "error",
        });
        return;
      }

      setDetailState({ data: payload.position, status: "ready" });
    } catch {
      setDetailState({
        message: "Unable to reach the position detail service.",
        status: "error",
      });
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialPositions() {
      const nextState = await fetchPositions();

      if (!cancelled) {
        setLoadState(nextState);
      }
    }

    void loadInitialPositions();

    return () => {
      cancelled = true;
    };
  }, []);

  const positions = loadState.status === "ready"
    ? activeTab === "open"
      ? loadState.data.openPositions
      : loadState.data.historyPositions
    : [];
  const openCount = loadState.status === "ready"
    ? loadState.data.openPositions.length
    : 0;
  const historyCount = loadState.status === "ready"
    ? loadState.data.historyPositions.length
    : 0;

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
        <PositionsList
          activeTab={activeTab}
          onSelect={(position) => void openDetail(position)}
          positions={positions}
        />
      ) : null}

      <PositionDetailDrawer
        detailState={detailState}
        onClose={() => setDetailState({ status: "idle" })}
      />
    </section>
  );
}
