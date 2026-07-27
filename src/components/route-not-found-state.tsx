import { ArrowLeft, SearchX } from "lucide-react";
import Link from "next/link";

export function RouteNotFoundState({
  backHref = "/",
  backLabel = "Alpha Dog home",
  message,
  title,
}: {
  backHref?: string;
  backLabel?: string;
  message: string;
  title: string;
}) {
  return (
    <main className="flex min-h-[calc(100dvh-3rem)] items-center bg-[#080a0c] px-4 py-10 text-zinc-100 sm:px-6">
      <section
        aria-labelledby="not-found-title"
        className="mx-auto w-full max-w-2xl rounded-xl border border-white/10 bg-[#151718] p-6 shadow-2xl shadow-black/25"
      >
        <span className="flex size-11 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-400/10 text-cyan-100">
          <SearchX aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-medium uppercase tracking-[0.16em] text-cyan-200">
          Not found
        </p>
        <h1
          className="mt-2 text-3xl font-semibold tracking-normal text-white"
          id="not-found-title"
        >
          {title}
        </h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
          {message}
        </p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          href={backHref}
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {backLabel}
        </Link>
      </section>
    </main>
  );
}
