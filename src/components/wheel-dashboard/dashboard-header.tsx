import {
  Activity,
  BarChart3,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import type {
  PersonaConfig,
  PersonaId,
} from "@/lib/wheel/types";
import type { RequestState } from "./types";

export function DashboardHeader({
  canAnalyze,
  canRefresh,
  initialPersonas,
  onAnalyze,
  onForceRefresh,
  onPersonaChange,
  onTickerChange,
  personaId,
  requestState,
  ticker,
}: {
  canAnalyze: boolean;
  canRefresh: boolean;
  initialPersonas: PersonaConfig[];
  onAnalyze: (event: FormEvent<HTMLFormElement>) => void;
  onForceRefresh: () => void;
  onPersonaChange: (personaId: PersonaId) => void;
  onTickerChange: (ticker: string) => void;
  personaId: PersonaId;
  requestState: RequestState;
  ticker: string;
}) {
  return (
    <div className="border-b border-white/10 bg-[#111314]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 md:px-6 xl:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-400/10">
              <BarChart3 className="size-5 text-emerald-200" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal text-white">
                Alpha Dog
              </h1>
              <p className="text-sm text-zinc-400">
                Wheel strategy decision dashboard
              </p>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <nav
              aria-label="Workspace"
              className="w-full max-w-full rounded-lg border border-white/10 bg-black/25 p-1 sm:w-auto"
            >
              <div className="grid min-w-0 grid-cols-3 gap-1 sm:flex sm:w-max">
                <Link
                  className="flex min-h-10 min-w-0 items-center justify-center rounded-md bg-emerald-300 px-2 py-2 text-center text-sm font-medium leading-snug text-black sm:px-3"
                  href="/screeners"
                >
                  Screeners
                </Link>
                <Link
                  className="flex min-h-10 min-w-0 items-center justify-center rounded-md px-2 py-2 text-center text-sm font-medium leading-snug text-zinc-300 transition hover:bg-white/[0.08] hover:text-white sm:px-3"
                  href="/traders"
                >
                  Traders
                </Link>
                <Link
                  className="flex min-h-10 min-w-0 items-center justify-center rounded-md px-2 py-2 text-center text-sm font-medium leading-snug text-zinc-300 transition hover:bg-white/[0.08] hover:text-white sm:px-3"
                  href="/account"
                >
                  Account
                </Link>
              </div>
            </nav>
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <ShieldAlert className="size-4 text-amber-200" />
              Decision support only. Not financial advice.
            </div>
          </div>
        </div>

        <form
          className="grid gap-3 md:grid-cols-[minmax(180px,240px)_minmax(220px,280px)_auto_auto] md:items-end"
          onSubmit={onAnalyze}
        >
          <label className="grid gap-1.5 text-sm">
            <span className="text-zinc-400">Ticker</span>
            <div className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3">
              <Search className="size-4 text-zinc-500" />
              <input
                aria-label="Ticker symbol"
                className="w-full bg-transparent font-mono text-base text-white outline-none"
                onChange={(event) => onTickerChange(event.target.value.toUpperCase())}
                placeholder="AAPL"
                value={ticker}
              />
            </div>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="text-zinc-400">Strategy persona</span>
            <select
              className="h-11 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
              onChange={(event) => onPersonaChange(event.target.value as PersonaId)}
              value={personaId}
            >
              {initialPersonas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}
                </option>
              ))}
            </select>
          </label>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-black transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              !canAnalyze ||
              requestState === "loading" ||
              requestState === "refreshing"
            }
            type="submit"
          >
            <Activity className="size-4" />
            Analyze
          </button>

          <button
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={
              !canRefresh ||
              requestState === "loading" ||
              requestState === "refreshing"
            }
            onClick={onForceRefresh}
            type="button"
          >
            <RefreshCw className="size-4" />
            Refresh
          </button>
        </form>
      </div>
    </div>
  );
}
