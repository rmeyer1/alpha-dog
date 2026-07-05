"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";

type AccountSummary = {
  cashBalance: number;
  marginBalance: number;
  marginInterestAccrued: number;
  marginInterestRate: number;
  openExposure: number;
  realizedPnl: number;
  totalPremiumCollected: number;
  unrealizedPnl: number | null;
  unrealizedPnlStatus: "available" | "unavailable";
};

type PaperAccount = {
  currentCash: number;
  id: string;
  marginBalance: number;
  marginInterestRate: number;
  startingCash: number;
};

type PaperAccountPayload = {
  account: PaperAccount;
  historyPositionCount: number;
  openPositionCount: number;
  summary: AccountSummary;
};

type LoadState =
  | { status: "loading" }
  | { message: string; status: "error" }
  | { data: PaperAccountPayload; status: "ready" };

type SaveState =
  | { status: "idle" }
  | { message: string; status: "error" }
  | { message: string; status: "success" }
  | { status: "saving" };

const PAPER_ACCOUNT_REFRESH_EVENT = "paper-account:refresh";
export const PAPER_STARTING_CASH_STEP = "0.01";

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

function formatPercent(value: number | null | undefined) {
  if (value == null) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    style: "percent",
  }).format(value);
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function MetricTile({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "positive" | "warning";
  value: string;
}) {
  const toneClass = {
    neutral: "text-zinc-100",
    positive: "text-emerald-100",
    warning: "text-amber-100",
  }[tone];

  return (
    <div className="border-t border-white/10 py-4 sm:border-t-0 sm:border-l sm:px-4 first:sm:border-l-0">
      <div className="text-xs font-medium uppercase text-zinc-500">
        {label}
      </div>
      <div className={`mt-2 font-mono text-xl font-semibold ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-zinc-400">
      <Loader2 className="size-4 animate-spin" />
      Loading simulated account
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

function EmptyAccountPrompt({
  disabled,
  onStartAtZero,
}: {
  disabled: boolean;
  onStartAtZero: () => void;
}) {
  return (
    <div className="border-t border-white/10 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-medium text-white">
            Start simulated tracking.
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            Begin with zero cash or enter a starting balance below before saving.
          </p>
        </div>
        <button
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={disabled}
          onClick={onStartAtZero}
          type="button"
        >
          Start at zero
        </button>
      </div>
    </div>
  );
}

function SettingsForm({
  data,
  onSaved,
}: {
  data: PaperAccountPayload;
  onSaved: () => void;
}) {
  const [startingCash, setStartingCash] = useState(() =>
    String(data.account.startingCash));
  const [marginRate, setMarginRate] = useState(() =>
    String((data.summary.marginInterestRate * 100).toFixed(2)));
  const [saveState, setSaveState] = useState<SaveState>({ status: "idle" });
  const isSaving = saveState.status === "saving";
  const isEmptyAccount = data.account.startingCash === 0 &&
    data.openPositionCount === 0 &&
    data.historyPositionCount === 0 &&
    data.summary.totalPremiumCollected === 0;

  async function saveSettings(settings: {
    marginInterestRate?: number;
    startingCash?: number;
  }) {
    setSaveState({ status: "saving" });

    try {
      const response = await fetch("/api/account/paper-account/settings", {
        body: JSON.stringify(settings),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = await response.json().catch(() => null) as
        | { error?: { message?: string } }
        | null;

      if (!response.ok) {
        setSaveState({
          message: payload?.error?.message ?? "Unable to save settings.",
          status: "error",
        });
        return;
      }

      setSaveState({
        message: "Paper account settings saved.",
        status: "success",
      });
      onSaved();
    } catch {
      setSaveState({
        message: "Unable to reach the paper account service.",
        status: "error",
      });
    }
  }

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedStartingCash = Number(startingCash);
    const parsedMarginRate = Number(marginRate);

    if (!Number.isFinite(parsedStartingCash) || parsedStartingCash < 0) {
      setSaveState({
        message: "Starting cash must be zero or greater.",
        status: "error",
      });
      return;
    }

    if (!Number.isFinite(parsedMarginRate) || parsedMarginRate < 0) {
      setSaveState({
        message: "Margin interest rate must be zero or greater.",
        status: "error",
      });
      return;
    }

    await saveSettings({
      marginInterestRate: parsedMarginRate / 100,
      startingCash: parsedStartingCash,
    });
  }

  return (
    <div className="border-t border-white/10 pt-4">
      {isEmptyAccount ? (
        <EmptyAccountPrompt
          disabled={isSaving}
          onStartAtZero={() => void saveSettings({ startingCash: 0 })}
        />
      ) : null}

      <form className="grid gap-4" onSubmit={(event) => void submitSettings(event)}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm" htmlFor="paperStartingCash">
            <span className="font-medium text-zinc-200">Starting cash</span>
            <input
              className="h-10 rounded-md border border-white/10 bg-black/30 px-3 font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-emerald-300"
              id="paperStartingCash"
              inputMode="decimal"
              min="0"
              onChange={(event) => setStartingCash(event.target.value)}
              step={PAPER_STARTING_CASH_STEP}
              type="number"
              value={startingCash}
            />
          </label>
          <label className="grid gap-1.5 text-sm" htmlFor="paperMarginRate">
            <span className="font-medium text-zinc-200">
              Margin interest rate
            </span>
            <div className="flex h-10 overflow-hidden rounded-md border border-white/10 bg-black/30 focus-within:ring-2 focus-within:ring-emerald-300">
              <input
                className="min-w-0 flex-1 bg-transparent px-3 font-mono text-zinc-100 focus:outline-none"
                id="paperMarginRate"
                min="0"
                onChange={(event) => setMarginRate(event.target.value)}
                step="0.01"
                type="number"
                value={marginRate}
              />
              <span className="inline-flex items-center border-l border-white/10 px-3 text-sm text-zinc-400">
                %
              </span>
            </div>
          </label>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-500">
            This is simulated account tracking only.
          </p>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSaving}
            type="submit"
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {isSaving ? "Saving" : "Save settings"}
          </button>
        </div>

        {saveState.status === "error" ? (
          <p aria-live="polite" className="text-sm text-red-100">
            {saveState.message}
          </p>
        ) : null}
        {saveState.status === "success" ? (
          <p
            aria-live="polite"
            className="inline-flex items-center gap-2 text-sm text-emerald-100"
          >
            <CheckCircle2 className="size-4" />
            {saveState.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function SummaryContent({
  data,
  onReload,
}: {
  data: PaperAccountPayload;
  onReload: () => void;
}) {
  const totalPnl = data.summary.unrealizedPnl == null
    ? data.summary.realizedPnl
    : data.summary.realizedPnl + data.summary.unrealizedPnl;
  const marginUsage = data.summary.openExposure > 0
    ? data.summary.marginBalance / data.summary.openExposure
    : 0;

  return (
    <div className="grid gap-5">
      <div className="grid sm:grid-cols-3">
        <MetricTile
          label="Total P/L"
          tone={totalPnl >= 0 ? "positive" : "warning"}
          value={formatCurrency(totalPnl)}
        />
        <MetricTile
          label="Premium collected"
          tone="positive"
          value={formatCurrency(data.summary.totalPremiumCollected)}
        />
        <MetricTile
          label="Cash balance"
          value={formatCurrency(data.summary.cashBalance)}
        />
      </div>

      <div className="grid sm:grid-cols-3">
        <MetricTile
          label="Margin balance"
          value={formatCurrency(data.summary.marginBalance)}
        />
        <MetricTile
          label="Margin usage"
          value={formatPercent(marginUsage)}
        />
        <MetricTile
          label="Margin rate"
          value={formatPercent(data.summary.marginInterestRate)}
        />
      </div>

      <div className="grid sm:grid-cols-3">
        <MetricTile
          label="Open positions"
          value={formatCount(data.openPositionCount)}
        />
        <MetricTile
          label="History"
          value={formatCount(data.historyPositionCount)}
        />
        <MetricTile
          label="Unrealized P/L"
          value={
            data.summary.unrealizedPnlStatus === "unavailable"
              ? "Unavailable"
              : formatCurrency(data.summary.unrealizedPnl)
          }
        />
      </div>

      <SettingsForm data={data} onSaved={onReload} />
    </div>
  );
}

async function fetchPaperAccount(): Promise<LoadState> {
  try {
    const response = await fetch("/api/account/paper-account", {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null) as
      | (Partial<PaperAccountPayload> & { error?: { message?: string } })
      | null;

    if (!response.ok || !payload?.account || !payload.summary) {
      return {
        message: payload?.error?.message ?? "Unable to load paper account summary.",
        status: "error",
      };
    }

    return {
      data: {
        account: payload.account,
        historyPositionCount: payload.historyPositionCount ?? 0,
        openPositionCount: payload.openPositionCount ?? 0,
        summary: payload.summary,
      },
      status: "ready",
    };
  } catch {
    return {
      message: "Unable to reach the paper account service.",
      status: "error",
    };
  }
}

export function PaperAccountPanel() {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });

  async function loadPaperAccount() {
    setLoadState({ status: "loading" });
    setLoadState(await fetchPaperAccount());
  }

  useEffect(() => {
    let cancelled = false;

    async function loadInitialPaperAccount() {
      const nextState = await fetchPaperAccount();

      if (!cancelled) {
        setLoadState(nextState);
      }
    }

    void loadInitialPaperAccount();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function refreshPaperAccount() {
      void loadPaperAccount();
    }

    window.addEventListener(PAPER_ACCOUNT_REFRESH_EVENT, refreshPaperAccount);

    return () => {
      window.removeEventListener(PAPER_ACCOUNT_REFRESH_EVENT, refreshPaperAccount);
    };
  }, []);

  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase text-emerald-200">
            Paper account
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
            Simulated position tracker
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Track paper premium-selling positions separately from any future
            broker-linked account.
          </p>
        </div>
        {loadState.status === "ready" ? (
          <button
            aria-label="Refresh paper account summary"
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08]"
            onClick={() => void loadPaperAccount()}
            type="button"
          >
            <RefreshCw className="size-4" />
            Refresh
          </button>
        ) : null}
      </div>

      {loadState.status === "loading" ? <LoadingState /> : null}
      {loadState.status === "error" ? (
        <ErrorState
          message={loadState.message}
          onRetry={() => void loadPaperAccount()}
        />
      ) : null}
      {loadState.status === "ready" ? (
        <SummaryContent
          data={loadState.data}
          onReload={() => void loadPaperAccount()}
        />
      ) : null}
    </section>
  );
}
