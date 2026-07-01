import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccountNavControl } from "@/components/account/account-nav-control";

export function AccountShell({
  children,
  eyebrow,
  icon,
  title,
}: {
  children: React.ReactNode;
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
}) {
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
            <p className="mt-4 text-sm font-medium uppercase text-emerald-200">
              {eyebrow}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-emerald-100">
                {icon}
              </span>
              <h1 className="text-3xl font-semibold tracking-normal text-white">
                {title}
              </h1>
            </div>
          </div>
          <div className="flex max-w-full flex-col gap-3 sm:flex-row sm:items-start">
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
                  className="rounded-md px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
                  href="/traders"
                >
                  Traders
                </Link>
                <Link
                  className="rounded-md bg-emerald-300 px-3 py-2 text-sm font-medium text-black"
                  href="/account"
                >
                  Account
                </Link>
              </div>
            </nav>
            <AccountNavControl returnPath="/account" />
          </div>
        </div>
      </header>
      {children}
    </main>
  );
}
