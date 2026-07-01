"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  UserCircle,
} from "lucide-react";
import type { AccountNavState } from "@/lib/supabase/account-nav";

type LocalState = AccountNavState | { status: "loading" };

function signInHref(returnPath: string) {
  const params = new URLSearchParams({ next: returnPath });

  return `/account?${params.toString()}`;
}

export function AccountNavControl({
  onSignedOut,
  returnPath,
}: {
  onSignedOut?: () => void;
  returnPath: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<LocalState>({ status: "loading" });
  const [logoutState, setLogoutState] =
    useState<"error" | "idle" | "signed_out" | "signing_out">("idle");

  useEffect(() => {
    let cancelled = false;

    async function loadAccountState() {
      try {
        const response = await fetch("/api/auth/account-state", {
          cache: "no-store",
        });
        const payload = await response.json() as
          | { account?: AccountNavState }
          | null;

        if (!cancelled) {
          setState(payload?.account ?? { status: "unauthenticated" });
        }
      } catch {
        if (!cancelled) {
          setState({
            message: "Account state unavailable.",
            status: "error",
          });
        }
      }
    }

    void loadAccountState();

    return () => {
      cancelled = true;
    };
  }, []);

  async function signOut() {
    setLogoutState("signing_out");

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        setLogoutState("error");
        return;
      }

      setState({ status: "unauthenticated" });
      setLogoutState("signed_out");
      onSignedOut?.();
      router.refresh();
    } catch {
      setLogoutState("error");
    }
  }

  if (state.status === "loading") {
    return (
      <div className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-zinc-400">
        <Loader2 className="size-4 animate-spin" />
        Account
      </div>
    );
  }

  if (state.status === "unauthenticated") {
    return (
      <Link
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#111314]"
        href={signInHref(returnPath)}
      >
        <UserCircle className="size-4" />
        Sign in
      </Link>
    );
  }

  if (state.status === "error") {
    return (
      <Link
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-red-300/25 bg-red-300/10 px-3 text-sm font-semibold text-red-100 transition hover:bg-red-300/15 focus:outline-none focus:ring-2 focus:ring-red-300 focus:ring-offset-2 focus:ring-offset-[#111314]"
        href={signInHref(returnPath)}
      >
        <AlertTriangle className="size-4" />
        Account unavailable
      </Link>
    );
  }

  const isIncomplete = state.status === "incomplete_profile";
  const label = state.status === "ready"
    ? state.displayName
    : state.email ?? "Profile needed";

  return (
    <div className="grid gap-2 rounded-lg border border-white/10 bg-black/25 p-2 sm:min-w-64">
      <Link
        className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-white/[0.08] focus:outline-none focus:ring-2 focus:ring-cyan-300"
        href={signInHref(returnPath)}
      >
        {isIncomplete ? (
          <AlertTriangle className="size-4 shrink-0 text-amber-200" />
        ) : (
          <CheckCircle2 className="size-4 shrink-0 text-emerald-200" />
        )}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-white">
            {label}
          </span>
          <span className="block truncate text-xs text-zinc-500">
            {isIncomplete ? "Complete profile" : state.email}
          </span>
        </span>
      </Link>

      <button
        className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-2 text-sm font-semibold text-zinc-200 transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={logoutState === "signing_out"}
        onClick={() => void signOut()}
        type="button"
      >
        {logoutState === "signing_out" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogOut className="size-4" />
        )}
        {logoutState === "signing_out" ? "Signing out" : "Sign out"}
      </button>

      {logoutState === "signed_out" ? (
        <p aria-live="polite" className="px-1 text-xs text-emerald-100">
          Signed out.
        </p>
      ) : null}
      {logoutState === "error" ? (
        <p aria-live="polite" className="px-1 text-xs text-red-100">
          Unable to sign out. Try again.
        </p>
      ) : null}
    </div>
  );
}
