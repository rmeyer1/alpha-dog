"use client";

import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import Link from "next/link";

export function RouteErrorRecovery({
  message,
  reset,
  title,
}: {
  message: string;
  reset: () => void;
  title: string;
}) {
  return (
    <main className="flex min-h-[calc(100dvh-3rem)] items-center bg-[#080a0c] px-4 py-10 text-zinc-100 sm:px-6">
      <section
        aria-labelledby="route-error-title"
        className="mx-auto w-full max-w-2xl rounded-xl border border-red-300/20 bg-[#151718] p-6 shadow-2xl shadow-black/25"
        role="alert"
      >
        <span className="flex size-11 items-center justify-center rounded-lg border border-red-300/20 bg-red-400/10 text-red-100">
          <AlertTriangle aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-red-200">
          Page recovery
        </p>
        <h1
          className="mt-2 text-3xl font-semibold tracking-normal text-white"
          id="route-error-title"
        >
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
          {message}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
            onClick={reset}
            type="button"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            Try again
          </button>
          <Link
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            href="/"
          >
            <Home aria-hidden="true" className="size-4" />
            Alpha Dog home
          </Link>
        </div>
        <p className="mt-5 text-xs leading-5 text-zinc-500">
          No technical error details are shown here. If retrying does not
          recover the page, return home and try the workflow again.
        </p>
      </section>
    </main>
  );
}
