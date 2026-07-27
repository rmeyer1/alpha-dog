import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";

export function LegalPageShell({
  children,
  description,
  title,
}: {
  children: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <main className="flex-1 bg-[#080a0c] px-4 py-10 text-zinc-100 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-4xl">
        <Link
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition hover:text-white"
          href="/"
        >
          <ArrowLeft className="size-4" />
          Alpha Dog
        </Link>
        <div className="mt-8 flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-4xl font-semibold tracking-normal text-white">
              {title}
            </h1>
            <p className="mt-3 max-w-3xl text-base leading-7 text-zinc-400">
              {description}
            </p>
            <p className="mt-2 text-xs uppercase tracking-[0.14em] text-zinc-500">
              Effective July 27, 2026
            </p>
          </div>
        </div>
        <div className="mt-8 grid gap-6 [&_a]:text-cyan-200 [&_a]:underline [&_a]:underline-offset-4 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-normal [&_h2]:text-white [&_li]:leading-7 [&_p]:leading-7 [&_p]:text-zinc-300 [&_ul]:grid [&_ul]:gap-2 [&_ul]:pl-6 [&_ul]:text-zinc-300 [&_ul]:list-disc">
          {children}
        </div>
      </article>
    </main>
  );
}
