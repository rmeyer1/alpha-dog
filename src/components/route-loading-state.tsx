export function RouteLoadingState({
  detail,
  label,
  title,
}: {
  detail: string;
  label: string;
  title: string;
}) {
  return (
    <main
      aria-busy="true"
      aria-labelledby="route-loading-title"
      className="min-h-[calc(100dvh-3rem)] bg-[#080a0c] px-4 py-6 text-zinc-100 sm:px-6 lg:px-8"
    >
      <div className="mx-auto grid max-w-7xl gap-5">
        <header className="rounded-xl border border-white/10 bg-[#151718] p-5">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-200">
            {label}
          </p>
          <h1
            className="mt-2 text-2xl font-semibold tracking-normal text-white"
            id="route-loading-title"
          >
            {title}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">{detail}</p>
        </header>
        <div
          aria-hidden="true"
          className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div className="grid gap-5">
            <div className="h-56 rounded-xl border border-white/10 bg-white/[0.04] motion-safe:animate-pulse" />
            <div className="h-80 rounded-xl border border-white/10 bg-white/[0.04] motion-safe:animate-pulse" />
          </div>
          <div className="grid content-start gap-5">
            <div className="h-40 rounded-xl border border-white/10 bg-white/[0.04] motion-safe:animate-pulse" />
            <div className="h-56 rounded-xl border border-white/10 bg-white/[0.04] motion-safe:animate-pulse" />
          </div>
        </div>
        <p className="sr-only" role="status">
          {title}
        </p>
      </div>
    </main>
  );
}
