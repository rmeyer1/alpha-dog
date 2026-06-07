import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckCircle2,
  Database,
  KeyRound,
  ShieldCheck,
  UserCircle,
} from "lucide-react";

const accountSections = [
  {
    title: "Profile",
    icon: UserCircle,
    rows: [
      ["Workspace", "Alpha Dog"],
      ["Role", "Owner"],
      ["Plan", "Local preview"],
    ],
  },
  {
    title: "Data Access",
    icon: Database,
    rows: [
      ["Market feed", "Alpaca"],
      ["Options data", "Configured by environment"],
      ["Demo mode", "Available"],
    ],
  },
  {
    title: "Security",
    icon: ShieldCheck,
    rows: [
      ["Credentials", "Server-side only"],
      ["Saved presets", "Local project store"],
      ["Decision support", "Enabled"],
    ],
  },
];

export default function AccountPage() {
  return (
    <main className="min-h-screen bg-[#080a0c] text-zinc-100">
      <header className="border-b border-white/10 bg-[#111314]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div>
            <Link
              className="inline-flex items-center gap-2 text-sm font-medium text-zinc-400 transition hover:text-white"
              href="/"
            >
              <ArrowLeft className="size-4" />
              Alpha Dog
            </Link>
            <h1 className="mt-4 text-3xl font-semibold tracking-normal text-white">
              Account
            </h1>
          </div>
          <nav
            aria-label="Account navigation"
            className="max-w-full overflow-x-auto rounded-lg border border-white/10 bg-black/25 p-1"
          >
            <div className="flex w-max gap-1">
              <Link
                className="rounded-md px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
                href="/screeners"
              >
                Screeners
              </Link>
              <Link
                className="rounded-md bg-emerald-300 px-3 py-2 text-sm font-medium text-black"
                href="/account"
              >
                Account
              </Link>
            </div>
          </nav>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <section className="grid gap-4">
          <div className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-sm font-medium uppercase text-emerald-200">
                  Workspace status
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">
                  Ready for logo and account integrations.
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
                  The account surface is in place for profile, data access,
                  security, and notification controls as authentication and
                  billing become part of the product.
                </p>
              </div>
              <div className="flex size-12 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-emerald-100">
                <CheckCircle2 className="size-6" />
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {accountSections.map((section) => (
              <section
                className="rounded-lg border border-white/10 bg-[#151718] p-5"
                key={section.title}
              >
                <section.icon className="size-5 text-cyan-200" />
                <h3 className="mt-4 text-lg font-semibold text-white">
                  {section.title}
                </h3>
                <dl className="mt-4 grid gap-3">
                  {section.rows.map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs uppercase text-zinc-500">
                        {label}
                      </dt>
                      <dd className="mt-1 text-sm text-zinc-200">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <KeyRound className="size-5 text-amber-200" />
            <h2 className="mt-4 text-lg font-semibold text-white">
              Credentials
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Alpaca keys remain environment-based and server-side. The
              account page is ready for a provider-backed credential status
              check when auth is added.
            </p>
          </section>

          <section className="rounded-lg border border-white/10 bg-[#151718] p-5">
            <Bell className="size-5 text-emerald-200" />
            <h2 className="mt-4 text-lg font-semibold text-white">
              Notifications
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-400">
              Future alerts can land here for screener refreshes, stale data,
              watchlist matches, and preset changes.
            </p>
          </section>
        </aside>
      </div>
    </main>
  );
}
