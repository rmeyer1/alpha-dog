"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
  Upload,
  X,
} from "lucide-react";

type ImportReviewGroup = {
  confidence: number;
  decision: "confirmed" | "rejected" | null;
  explanation: string[];
  groupId: string;
  groupKey: string;
  reviewReason: string | null;
  sourceRowIndexes: number[];
  status: string;
  strategyType: string;
  symbol: string | null;
};

type ImportSummary = {
  dividendsTracked: number;
  duplicateRows: number;
  equityLots: number;
  excludedRows: number;
  ignoredRows: number;
  importedRecords: number;
  insertedEquityLots: number;
  insertedEvents: number;
  insertedPositions: number;
  optionPositions: number;
  rejectedGroups: number;
  reviewGroups: number;
  skippedDuplicates: number;
  stagedRows: number;
};

type ImportPayload = {
  broker: string;
  fileName: string;
  importId: string;
  isDuplicate: boolean;
  reviewGroups: ImportReviewGroup[];
  status: "failed" | "imported" | "needs_review" | "parsed" | "uploaded";
  summary: ImportSummary;
};

type ImportState =
  | { status: "idle" }
  | { status: "importing" }
  | { message: string; status: "error" }
  | {
    data: ImportPayload;
    decisions: Record<string, "confirmed" | "rejected">;
    error: string | null;
    pendingGroups: Record<string, boolean>;
    status: "success";
    submittingFinalize: boolean;
  };

const PAPER_ACCOUNT_REFRESH_EVENT = "paper-account:refresh";
const LAST_STATEMENT_IMPORT_KEY = "alpha-dog:last-statement-import";

function formatBroker(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
    style: "percent",
  }).format(value);
}

function SummaryTile({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <div className="border-t border-white/10 py-3 sm:border-l sm:border-t-0 sm:px-4 first:sm:border-l-0">
      <div className="text-xs font-medium uppercase text-zinc-500">
        {label}
      </div>
      <div className="mt-2 font-mono text-lg font-semibold text-zinc-100">
        {value}
      </div>
    </div>
  );
}

function ReviewGroups({
  decisions,
  groups,
  onDecision,
  pendingGroups,
}: {
  decisions: Record<string, "confirmed" | "rejected">;
  groups: ImportReviewGroup[];
  onDecision: (group: ImportReviewGroup, decision: "confirmed" | "rejected") => void;
  pendingGroups: Record<string, boolean>;
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 border-t border-white/10 pt-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase text-amber-200">
        <AlertTriangle className="size-4" />
        Needs review
      </div>
      {groups.map((group) => {
        const decision = decisions[group.groupKey];
        const isPending = pendingGroups[group.groupId] ?? false;

        return (
          <div
            className="rounded-lg border border-amber-300/20 bg-amber-300/10 p-4"
            key={group.groupKey}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-medium text-white">
                  {group.symbol ?? "Unknown symbol"} · {formatBroker(group.strategyType)}
                </p>
                <p className="mt-1 text-sm text-amber-100">
                  Confidence {formatPercent(group.confidence)}
                </p>
                <p className="mt-2 text-sm leading-6 text-zinc-300">
                  {group.reviewReason ?? group.explanation[0] ?? "Review this suggested group."}
                </p>
                <p className="mt-2 text-xs text-zinc-500">
                  Rows {group.sourceRowIndexes.join(", ")}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-emerald-300 px-3 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:opacity-60"
                  disabled={isPending || decision === "confirmed"}
                  onClick={() => onDecision(group, "confirmed")}
                  type="button"
                >
                  {isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Confirm
                </button>
                <button
                  className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 text-sm font-semibold text-zinc-100 transition hover:bg-white/[0.08] disabled:opacity-60"
                  disabled={isPending || decision === "rejected"}
                  onClick={() => onDecision(group, "rejected")}
                  type="button"
                >
                  <X className="size-4" />
                  Reject
                </button>
              </div>
            </div>
            {decision ? (
              <p className="mt-3 text-sm text-emerald-100">
                Marked {decision}.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function StatementImportPanel() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [state, setState] = useState<ImportState>({ status: "idle" });
  const isImporting = state.status === "importing";

  function successState(data: ImportPayload): Extract<ImportState, { status: "success" }> {
    return {
      data,
      decisions: Object.fromEntries(
        data.reviewGroups.flatMap((group) =>
          group.decision ? [[group.groupKey, group.decision]] : []
        ),
      ),
      error: null,
      pendingGroups: {},
      status: "success",
      submittingFinalize: false,
    };
  }

  useEffect(() => {
    const importId = window.localStorage.getItem(LAST_STATEMENT_IMPORT_KEY);

    if (!importId) {
      return;
    }

    let ignore = false;

    async function loadImport() {
      const response = await fetch(`/api/account/statement-import/${importId}`);
      const payload = await response.json().catch(() => null) as ImportPayload | null;

      if (!ignore && response.ok && payload?.summary) {
        setState(successState(payload));
      }
    }

    void loadImport();

    return () => {
      ignore = true;
    };
  }, []);

  async function setDecision(group: ImportReviewGroup, decision: "confirmed" | "rejected") {
    const importId = state.status === "success" ? state.data.importId : null;

    if (!importId) {
      return;
    }

    setState((current) => {
      if (current.status !== "success") {
        return current;
      }

      return {
        ...current,
        error: null,
        decisions: {
          ...current.decisions,
          [group.groupKey]: decision,
        },
        pendingGroups: {
          ...current.pendingGroups,
          [group.groupId]: true,
        },
      };
    });

    try {
      const response = await fetch(
        `/api/account/statement-import/${importId}/groups/${group.groupId}`,
        {
          body: JSON.stringify({ decision }),
          headers: { "content-type": "application/json" },
          method: "PATCH",
        },
      );
      const payload = await response.json().catch(() => null) as
        | (ImportPayload & { error?: { message?: string } })
        | null;

      if (!response.ok || !payload?.summary) {
        setState((current) =>
          current.status === "success"
            ? {
              ...current,
              error: payload?.error?.message ?? "Unable to save review decision.",
              pendingGroups: { ...current.pendingGroups, [group.groupId]: false },
            }
            : current
        );
        return;
      }

      setState(successState(payload));
    } catch {
      setState((current) =>
        current.status === "success"
          ? {
            ...current,
            error: "Unable to reach the statement import service.",
            pendingGroups: { ...current.pendingGroups, [group.groupId]: false },
          }
          : current
      );
    }
  }

  async function finalizeImport() {
    if (state.status !== "success") {
      return;
    }

    setState({
      ...state,
      error: null,
      submittingFinalize: true,
    });

    try {
      const response = await fetch(`/api/account/statement-import/${state.data.importId}/finalize`, {
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as
        | (ImportPayload & { error?: { message?: string } })
        | null;

      if (!response.ok || !payload?.summary) {
        setState((current) =>
          current.status === "success"
            ? {
              ...current,
              error: payload?.error?.message ?? "Unable to finalize statement import.",
              submittingFinalize: false,
            }
            : current
        );
        return;
      }

      setState(successState(payload));
      window.dispatchEvent(new Event(PAPER_ACCOUNT_REFRESH_EVENT));
    } catch {
      setState((current) =>
        current.status === "success"
          ? {
            ...current,
            error: "Unable to reach the statement import service.",
            submittingFinalize: false,
          }
          : current
      );
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const file = fileInputRef.current?.files?.[0];

    if (!file) {
      setState({
        message: "Choose a CSV file before importing.",
        status: "error",
      });
      return;
    }

    const formData = new FormData();
    formData.set("file", file);
    setState({ status: "importing" });

    try {
      const response = await fetch("/api/account/statement-import", {
        body: formData,
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as
        | (ImportPayload & { error?: { message?: string } })
        | null;

      if (!response.ok || !payload?.summary) {
        setState({
          message: payload?.error?.message ?? "Unable to import statement.",
          status: "error",
        });
        return;
      }

      setState({
        ...successState(payload),
      });
      window.localStorage.setItem(LAST_STATEMENT_IMPORT_KEY, payload.importId);
      if (payload.status === "imported") {
        window.dispatchEvent(new Event(PAPER_ACCOUNT_REFRESH_EVENT));
      }
    } catch {
      setState({
        message: "Unable to reach the statement import service.",
        status: "error",
      });
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium uppercase text-cyan-200">
            <FileText className="size-4" />
            Statement import
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
            Upload broker activity
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-400">
            Robinhood CSV is supported first.
          </p>
        </div>
      </div>

      <form className="grid gap-4" onSubmit={(event) => void submitImport(event)}>
        <label className="grid gap-1.5 text-sm" htmlFor="statementImportFile">
          <span className="font-medium text-zinc-200">CSV file</span>
          <input
            accept=".csv,text/csv"
            className="min-h-10 rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 file:mr-3 file:rounded-md file:border-0 file:bg-white/[0.08] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-300"
            disabled={isImporting}
            id="statementImportFile"
            ref={fileInputRef}
            type="file"
          />
        </label>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-zinc-500">
            Deposits, transfers, and interest are summarized but not applied to cash.
          </p>
          <button
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-cyan-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isImporting}
            type="submit"
          >
            {isImporting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {isImporting ? "Importing" : "Import CSV"}
          </button>
        </div>
      </form>

      {state.status === "importing" ? (
        <div className="mt-4 rounded-lg border border-cyan-300/20 bg-cyan-300/10 p-4 text-sm text-cyan-100">
          <div className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin" />
            Parsing statement and writing high-confidence rows
          </div>
        </div>
      ) : null}

      {state.status === "error" ? (
        <div
          aria-live="polite"
          className="mt-4 rounded-lg border border-red-300/25 bg-red-300/10 p-4 text-sm text-red-100"
        >
          {state.message}
        </div>
      ) : null}

      {state.status === "success" ? (
        <div aria-live="polite" className="mt-5 grid gap-4">
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4">
            <div className="flex items-start gap-2 text-emerald-100">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <div>
                <p className="font-medium text-white">
                  {formatBroker(state.data.broker)} import {state.data.status === "imported" ? "complete" : "staged"}
                </p>
                <p className="mt-1 text-sm text-zinc-300">
                  {state.data.fileName}
                </p>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-4">
            <SummaryTile
              label="Imported"
              value={state.data.summary.importedRecords}
            />
            <SummaryTile
              label="Duplicates"
              value={state.data.summary.skippedDuplicates + state.data.summary.duplicateRows}
            />
            <SummaryTile
              label="Rejected"
              value={state.data.summary.rejectedGroups}
            />
            <SummaryTile
              label="Needs review"
              value={state.data.summary.reviewGroups}
            />
          </div>

          {state.data.summary.skippedDuplicates > 0 ? (
            <p className="text-sm text-zinc-400">
              Duplicate paper-account records were skipped, so rerunning this file
              will not double count supported imports.
            </p>
          ) : null}

          {state.data.summary.ignoredRows > 0 ? (
            <p className="text-sm text-zinc-400">
              Ignored rows include MVP-excluded cash movement such as deposits,
              transfers, and interest.
            </p>
          ) : null}

          <ReviewGroups
            decisions={state.decisions}
            groups={state.data.reviewGroups}
            onDecision={setDecision}
            pendingGroups={state.pendingGroups}
          />

          {state.error ? (
            <div className="rounded-lg border border-red-300/25 bg-red-300/10 p-4 text-sm text-red-100">
              {state.error}
            </div>
          ) : null}

          {state.data.status !== "imported" ? (
            <div className="flex justify-end">
              <button
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={state.submittingFinalize || state.data.summary.reviewGroups > 0}
                onClick={() => void finalizeImport()}
                type="button"
              >
                {state.submittingFinalize ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Finalize import
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
