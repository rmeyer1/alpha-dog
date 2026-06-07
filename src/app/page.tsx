import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CircleDollarSign,
  Gauge,
  LineChart,
  LockKeyhole,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";

const tabs = [
  { label: "Wheel Screener", href: "/screeners" },
  { label: "Put Spreads", href: "/screeners#put-spreads" },
  { label: "Covered Calls", href: "/screeners#covered-calls" },
  { label: "Account", href: "/account" },
];

const screeners = [
  {
    name: "Wheel Screener",
    status: "Live",
    href: "/screeners",
    icon: CircleDollarSign,
    description:
      "Rank cash-secured puts and covered calls by yield, liquidity, trend, and risk fit.",
    metrics: ["Top 50 candidates", "Persona filters", "Freshness status"],
  },
  {
    name: "Credit Spreads",
    status: "Live",
    href: "/screeners#put-spreads",
    icon: ShieldCheck,
    description:
      "Compare defined-risk put and call spreads with return-on-risk and warning signals.",
    metrics: ["Width-aware scoring", "Delta bands", "Risk warnings"],
  },
  {
    name: "Company Drilldown",
    status: "Live",
    href: "/screeners",
    icon: LineChart,
    description:
      "Jump from ranked companies into ticker-level contracts and strategy candidates.",
    metrics: ["Ticker search", "Market snapshot", "Contract tabs"],
  },
];

const trustItems = [
  {
    icon: Gauge,
    title: "Fast filtering",
    body: "Move from broad universe ranking to ticker-level conviction without rebuilding filters.",
  },
  {
    icon: SlidersHorizontal,
    title: "Persona controls",
    body: "Tune DTE, delta, premium, IV, liquidity, and risk settings for the way you trade.",
  },
  {
    icon: Bell,
    title: "Clear warnings",
    body: "Surface stale data, liquidity gaps, trend concerns, and concentration risks before action.",
  },
];

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 items-center justify-center rounded-lg border border-emerald-300/30 bg-black/40 text-sm font-semibold text-emerald-100 shadow-sm">
        AD
      </div>
      <span className="text-lg font-semibold text-white">Alpha Dog</span>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-[#080a0c] text-zinc-100">
      <section className="relative isolate min-h-[78svh] overflow-hidden border-b border-white/10">
        <Image
          alt="Alpha Dog options screener dashboard preview"
          className="object-cover object-center opacity-[0.54]"
          fill
          priority
          sizes="100vw"
          src="/alpha-dog-dashboard-preview.png"
        />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(8,10,12,0.97)_0%,rgba(8,10,12,0.86)_38%,rgba(8,10,12,0.5)_72%,rgba(8,10,12,0.82)_100%)]" />
        <div className="relative z-10 mx-auto flex min-h-[78svh] max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
          <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <BrandMark />
            <nav
              aria-label="Primary"
              className="max-w-full overflow-x-auto rounded-lg border border-white/10 bg-black/35 p-1"
            >
              <div className="flex w-max gap-1">
                {tabs.map((tab, index) => (
                  <Link
                    className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                      index === 0
                        ? "bg-emerald-300 text-black"
                        : "text-zinc-300 hover:bg-white/10 hover:text-white"
                    }`}
                    href={tab.href}
                    key={tab.label}
                  >
                    {tab.label}
                  </Link>
                ))}
              </div>
            </nav>
          </header>

          <div className="flex flex-1 items-center py-14 sm:py-18">
            <div className="max-w-3xl">
              <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-sm font-medium text-emerald-100">
                <TrendingUp className="size-4" />
                Options screeners for disciplined income trades
              </div>
              <h1 className="mt-6 max-w-2xl text-5xl font-semibold leading-[1.02] tracking-normal text-white sm:text-6xl lg:text-7xl">
                Alpha Dog
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-200 sm:text-xl">
                Rank wheel, spread, and covered-call opportunities with the
                filters, warnings, and freshness checks needed for repeatable
                decision support.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-5 text-sm font-semibold text-black transition hover:bg-emerald-200"
                  href="/screeners"
                >
                  Open screeners
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-5 text-sm font-semibold text-white transition hover:bg-white/[0.1]"
                  href="/account"
                >
                  Account
                  <LockKeyhole className="size-4" />
                </Link>
              </div>
            </div>
          </div>

          <div className="grid gap-3 pb-2 sm:grid-cols-3">
            {[
              ["Universe", "Top 50 ranked"],
              ["Strategies", "4 contract views"],
              ["Signals", "Risk and liquidity"],
            ].map(([label, value]) => (
              <div
                className="rounded-lg border border-white/10 bg-black/40 px-4 py-3 backdrop-blur"
                key={label}
              >
                <div className="text-xs uppercase text-zinc-500">{label}</div>
                <div className="mt-1 text-sm font-semibold text-white">
                  {value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#101315]">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase text-emerald-200">
                Screeners
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-normal text-white">
                One workspace for the strategies already in motion.
              </h2>
            </div>
            <Link
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/15 px-4 text-sm font-semibold text-white transition hover:bg-white/[0.06]"
              href="/screeners"
            >
              Launch workspace
              <BarChart3 className="size-4" />
            </Link>
          </div>

          <div className="mt-8 grid gap-4 lg:grid-cols-3">
            {screeners.map((screener) => (
              <Link
                className="group rounded-lg border border-white/10 bg-[#171a1d] p-5 transition hover:border-emerald-300/35 hover:bg-[#1b1f22]"
                href={screener.href}
                key={screener.name}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex size-11 items-center justify-center rounded-lg border border-white/10 bg-black/25 text-emerald-200">
                    <screener.icon className="size-5" />
                  </div>
                  <span className="rounded-md border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-xs font-medium text-emerald-100">
                    {screener.status}
                  </span>
                </div>
                <h3 className="mt-5 text-xl font-semibold text-white">
                  {screener.name}
                </h3>
                <p className="mt-3 min-h-[72px] text-sm leading-6 text-zinc-400">
                  {screener.description}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {screener.metrics.map((metric) => (
                    <span
                      className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-xs text-zinc-300"
                      key={metric}
                    >
                      {metric}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#080a0c]">
        <div className="mx-auto grid max-w-7xl gap-4 px-4 py-12 sm:px-6 md:grid-cols-3 lg:px-8">
          {trustItems.map((item) => (
            <div
              className="rounded-lg border border-white/10 bg-white/[0.035] p-5"
              key={item.title}
            >
              <item.icon className="size-5 text-cyan-200" />
              <h3 className="mt-4 text-lg font-semibold text-white">
                {item.title}
              </h3>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                {item.body}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
