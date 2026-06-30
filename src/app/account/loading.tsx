import { Loader2 } from "lucide-react";

export default function AccountLoading() {
  return (
    <main className="min-h-screen bg-[#080a0c] text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-7xl items-center px-4 sm:px-6 lg:px-8">
        <section className="w-full rounded-lg border border-white/10 bg-[#151718] p-5">
          <div className="flex items-center gap-3 text-emerald-100">
            <Loader2 className="size-5 animate-spin" />
            <h1 className="text-lg font-semibold text-white">
              Loading account state
            </h1>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="h-24 rounded-lg bg-white/[0.06]" />
            <div className="h-24 rounded-lg bg-white/[0.06]" />
            <div className="h-24 rounded-lg bg-white/[0.06]" />
          </div>
        </section>
      </div>
    </main>
  );
}
