export default function CompanyProfileLoading() {
  return (
    <main className="min-h-screen bg-[#0b0c0d] text-zinc-100">
      <div className="mx-auto grid max-w-[1600px] gap-5 px-4 py-5 md:px-6 xl:px-8">
        <div className="h-32 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid gap-5">
            <div className="h-96 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
            <div className="h-80 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
            <div className="h-72 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
          </div>
          <div className="grid content-start gap-5">
            <div className="h-72 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
            <div className="h-72 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
          </div>
        </div>
      </div>
    </main>
  );
}
