import Image from "next/image";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  ShieldAlert,
  UserCircle,
  UserRoundSearch,
} from "lucide-react";

const destinations = [
  {
    label: "Wheel Screener",
    detail: "Rank cash-secured puts, spreads, and covered-call candidates.",
    href: "/screeners",
    icon: BarChart3,
    variant:
      "border-emerald-300/35 bg-emerald-300 text-[#051626] shadow-[0_18px_45px_rgba(31,199,55,0.16)] hover:bg-emerald-200",
  },
  {
    label: "Trader Intelligence",
    detail: "Track trader quality, whale exposure, and shared conviction.",
    href: "/traders",
    icon: UserRoundSearch,
    variant:
      "border-cyan-300/35 bg-cyan-300 text-[#051626] shadow-[0_18px_45px_rgba(34,211,238,0.16)] hover:bg-cyan-200",
  },
  {
    label: "Account",
    detail: "Data access, saved presets, credentials, and alert readiness.",
    href: "/account",
    icon: UserCircle,
    variant:
      "border border-white/15 bg-white/[0.06] text-white shadow-[0_16px_35px_rgba(0,0,0,0.18)] hover:bg-white/[0.1]",
  },
];

const statusTiles = [
  {
    label: "Primary desk",
    value: "Wheel Screener",
    icon: Activity,
    tone: "text-emerald-200",
  },
  {
    label: "Data posture",
    value: "OPRA / cache aware",
    icon: Database,
    tone: "text-cyan-200",
  },
  {
    label: "Risk posture",
    value: "Warnings visible",
    icon: ShieldAlert,
    tone: "text-amber-200",
  },
  {
    label: "Refresh model",
    value: "On demand",
    icon: Clock3,
    tone: "text-zinc-200",
  },
];

export default function Home() {
  return (
    <main className="min-h-dvh overflow-hidden bg-[#080a0c] text-white">
      <div className="mx-auto flex min-h-dvh max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-4">
          <Link
            className="inline-flex items-center gap-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#080a0c]"
            href="/"
          >
            <Image
              alt=""
              className="size-10 rounded-lg object-cover"
              height={80}
              priority
              src="/alpha-dog-logo-on-dark.png"
              width={80}
            />
            <span className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-200">
              Alpha Dog
            </span>
          </Link>
          <div className="hidden items-center gap-2 text-xs text-zinc-400 sm:flex">
            <ShieldAlert className="size-4 text-amber-200" />
            Decision support only
          </div>
        </header>

        <section className="grid flex-1 content-center gap-8 py-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1fr)] lg:items-center lg:gap-12">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.16em] text-emerald-100">
              Sell-side derivatives desk
            </div>
            <h1 className="mt-5 max-w-xl text-4xl font-semibold tracking-normal text-white sm:text-5xl">
              Risk-aware option screens, ready at the open.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-zinc-400">
              Rank structures, inspect liquidity, and keep stale data or
              earnings risk in the decision path.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-5 text-sm font-semibold text-[#051626] shadow-[0_18px_45px_rgba(31,199,55,0.16)] transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#080a0c]"
                href="/screeners"
              >
                <BarChart3 className="size-5" />
                Open Wheel Screener
              </Link>
              <Link
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-5 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#080a0c]"
                href="/traders"
              >
                <UserRoundSearch className="size-5" />
                Trader Intelligence
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            <section className="rounded-lg border border-white/10 bg-[#111314] p-4 shadow-2xl shadow-black/25">
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <div className="text-sm font-medium text-white">
                    Desk status
                  </div>
                  <div className="mt-1 text-xs text-zinc-500">
                    Fast checks before opening a strategy view.
                  </div>
                </div>
                <span className="rounded-md border border-emerald-300/25 bg-emerald-400/10 px-2 py-1 text-xs font-medium text-emerald-100">
                  Ready
                </span>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {statusTiles.map((tile) => (
                  <div
                    className="rounded-lg border border-white/10 bg-black/20 p-3"
                    key={tile.label}
                  >
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <tile.icon className={`size-4 ${tile.tone}`} />
                      {tile.label}
                    </div>
                    <div className="mt-2 font-mono text-sm text-zinc-100">
                      {tile.value}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <nav
              aria-label="Destination"
              className="grid grid-cols-1 gap-3"
            >
              {destinations.map((destination) => (
                <Link
                  className={`group grid min-h-20 gap-1 rounded-lg border px-4 py-3 transition focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2 focus:ring-offset-[#080a0c] ${destination.variant}`}
                  href={destination.href}
                  key={destination.label}
                >
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <destination.icon className="size-5" />
                    {destination.label}
                  </span>
                  <span className="text-sm opacity-75">
                    {destination.detail}
                  </span>
                </Link>
              ))}
            </nav>
          </div>
        </section>
      </div>
    </main>
  );
}
