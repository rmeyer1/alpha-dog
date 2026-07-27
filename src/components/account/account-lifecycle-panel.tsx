"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DATA_RETENTION_POLICY,
} from "@/lib/account/data-lifecycle-contract";

type DeleteState =
  | { status: "deleted" }
  | { message: string; reauthenticationRequired?: boolean; status: "error" }
  | { status: "idle" }
  | { status: "submitting" };

export function AccountLifecyclePanel({ email }: { email: string }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [confirmedEmail, setConfirmedEmail] = useState("");
  const [irreversibleAcknowledged, setIrreversibleAcknowledged] =
    useState(false);
  const [deleteState, setDeleteState] = useState<DeleteState>({
    status: "idle",
  });
  const canDelete = confirmedEmail.trim().toLowerCase() ===
      email.trim().toLowerCase() &&
    confirmation === ACCOUNT_DELETION_CONFIRMATION &&
    irreversibleAcknowledged &&
    deleteState.status !== "submitting";

  async function deleteAccount() {
    if (!canDelete) {
      return;
    }

    setDeleteState({ status: "submitting" });

    try {
      const response = await fetch("/api/account/deletion", {
        body: JSON.stringify({
          acknowledgedIrreversible: irreversibleAcknowledged,
          confirmation,
          email: confirmedEmail,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => null) as
        | {
            error?: {
              code?: string;
              message?: string;
            };
          }
        | null;

      if (!response.ok) {
        setDeleteState({
          message: payload?.error?.message ??
            "Unable to delete this account. Try again.",
          reauthenticationRequired:
            payload?.error?.code ===
              "ACCOUNT_DELETION_REAUTHENTICATION_REQUIRED" ||
            payload?.error?.code === "ACCOUNT_DELETION_RETRY_EXPIRED",
          status: "error",
        });
        return;
      }

      setDeleteState({ status: "deleted" });
      router.push("/");
      router.refresh();
    } catch {
      setDeleteState({
        message: "Unable to delete this account. Try again.",
        status: "error",
      });
    }
  }

  return (
    <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
          <ShieldCheck className="size-5" />
        </span>
        <div>
          <p className="text-xs font-medium uppercase text-cyan-200">
            Data controls
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
            Export and account lifecycle
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-400">
            Download your Alpha Dog account and financial-history records, or
            permanently delete the account after a recent sign-in.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Download className="size-4 text-cyan-200" />
            Account export
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">
            The JSON export includes your profile, provider identities,
            presets, imports and review decisions, paper-account settings,
            positions, legs, events, and equity lots. Database isolation limits
            the export to this signed-in account.
          </p>
          <a
            className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-3 text-sm font-semibold text-[#051626] transition hover:bg-cyan-200 focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
            download
            href="/api/account/export"
          >
            <Download className="size-4" />
            Download JSON export
          </a>
        </section>

        <section className="rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-semibold text-white">
            Retention summary
          </div>
          <ul className="mt-3 grid gap-2 text-sm leading-6 text-zinc-400">
            <li>
              Failed or unfinished imports:{" "}
              {ACCOUNT_DATA_RETENTION_POLICY.incompleteImportsDays} days
            </li>
            <li>
              Raw normalized rows after import:{" "}
              {ACCOUNT_DATA_RETENTION_POLICY.rawImportRowsDays} days
            </li>
            <li>
              Completed import and review metadata:{" "}
              {ACCOUNT_DATA_RETENTION_POLICY.completedImportMetadataDays} days
            </li>
            <li>
              Provider-analysis request history:{" "}
              {ACCOUNT_DATA_RETENTION_POLICY.analysisRequestsDays} days
            </li>
          </ul>
          <Link
            className="mt-4 inline-flex text-sm font-semibold text-cyan-200 underline decoration-cyan-300/40 underline-offset-4 hover:text-cyan-100"
            href="/privacy"
          >
            Read the privacy and retention notice
          </Link>
        </section>
      </div>

      <details className="mt-4 rounded-lg border border-red-300/25 bg-red-300/[0.06] p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-red-100 marker:hidden">
          <span className="inline-flex items-center gap-2">
            <Trash2 className="size-4" />
            Permanently delete account
          </span>
        </summary>

        <div className="mt-4 border-t border-red-300/20 pt-4">
          <div className="flex items-start gap-2 text-sm leading-6 text-red-100">
            <AlertTriangle className="mt-1 size-4 shrink-0" />
            <p>
              This revokes refresh sessions, deletes account-owned application
              data, and hard-deletes the Auth user. After completion, Alpha Dog
              cannot restore the individual account from product backups.
            </p>
          </div>

          <div className="mt-4 grid gap-4">
            <label className="grid gap-2 text-sm text-zinc-300">
              Confirm your account email
              <input
                autoComplete="email"
                className="min-h-11 rounded-lg border border-white/15 bg-black/30 px-3 text-white outline-none transition focus:border-red-300/60 focus:ring-2 focus:ring-red-300/30"
                onChange={(event) => setConfirmedEmail(event.target.value)}
                placeholder={email}
                type="email"
                value={confirmedEmail}
              />
            </label>

            <label className="grid gap-2 text-sm text-zinc-300">
              Type <strong className="text-red-100">{ACCOUNT_DELETION_CONFIRMATION}</strong>
              <input
                autoComplete="off"
                className="min-h-11 rounded-lg border border-white/15 bg-black/30 px-3 font-mono text-white outline-none transition focus:border-red-300/60 focus:ring-2 focus:ring-red-300/30"
                onChange={(event) => setConfirmation(event.target.value)}
                spellCheck={false}
                value={confirmation}
              />
            </label>

            <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-black/20 p-3 text-sm leading-6 text-zinc-300">
              <input
                checked={irreversibleAcknowledged}
                className="mt-1 size-4 accent-red-300"
                onChange={(event) =>
                  setIrreversibleAcknowledged(event.target.checked)}
                type="checkbox"
              />
              I understand that deletion is irreversible after Auth removal and
              that any disaster-recovery backup expires on the provider backup
              schedule rather than being available for individual restoration.
            </label>
          </div>

          <button
            className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-red-300 px-4 text-sm font-semibold text-[#2a0707] transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canDelete}
            onClick={() => void deleteAccount()}
            type="button"
          >
            {deleteState.status === "submitting" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
            {deleteState.status === "submitting"
              ? "Deleting account"
              : "Delete account permanently"}
          </button>

          {deleteState.status === "error" ? (
            <div
              aria-live="assertive"
              className="mt-3 rounded-lg border border-red-300/25 bg-red-300/10 p-3 text-sm leading-6 text-red-100"
            >
              <p>{deleteState.message}</p>
              {deleteState.reauthenticationRequired ? (
                <p className="mt-2">
                  Use the account control above to sign out, sign back in, and
                  return here before retrying.
                </p>
              ) : null}
            </div>
          ) : null}

          {deleteState.status === "deleted" ? (
            <p
              aria-live="polite"
              className="mt-3 inline-flex items-center gap-2 text-sm text-emerald-100"
            >
              <CheckCircle2 className="size-4" />
              Account deleted.
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}
