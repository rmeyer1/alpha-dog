"use client";

import {
  BadgeCheck,
  BarChart3,
  Copy,
  Crosshair,
  RefreshCw,
  Search,
  Target,
  TrendingUp,
  UserRoundSearch,
  Wallet,
  Waves,
  X,
} from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PolymarketLeaderboardResponse,
  PolymarketSharpPlaysResponse,
  PolymarketWhalesResponse,
  SharpPlay,
  TraderSummary,
  TraderWalletProfile,
  WhaleCandidate,
} from "@/lib/polymarket/types";
import {
  parseTraderDashboardState,
  serializeTraderDashboardState,
  type TraderAppliedFilters,
  type TraderDashboardTab,
  type TraderDashboardUrlState,
} from "@/lib/dashboard-url-state";
import {
  isAbortError,
  LatestRequestLifecycle,
} from "@/lib/request-lifecycle";
import { AccessibleOverlay } from "@/components/ui/accessible-overlay";
import { FilterControls } from "./trader-intelligence/filter-controls";
import { ListPresentation } from "./trader-intelligence/list-presentation";
import {
  appliedFilterLabel,
  defaultTraderFilters,
  formatMoney,
  formatNumber,
  formatPercent,
  labelClass,
  scoreClass,
  shortWallet,
  walletPattern,
} from "./trader-intelligence/domain";
import { useAsyncRequestState, type RequestState } from "./trader-intelligence/request-state";

type DashboardTab = TraderDashboardTab;
interface ApiErrorPayload {
  error: {
    message: string;
  };
}

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}


function freshnessLabel(
  response:
    | PolymarketLeaderboardResponse
    | PolymarketSharpPlaysResponse
    | PolymarketWhalesResponse
    | TraderWalletProfile
    | null,
) {
  if (!response) {
    return "No data";
  }

  const status = response.dataFreshness.cacheStatus === "demo"
    ? "Demo"
    : response.dataFreshness.cacheStatus === "fresh"
      ? "Cached"
      : "Live";

  return `${status} ${new Date(response.dataFreshness.asOf).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function TraderAvatar({
  name,
  src,
}: {
  name: string;
  src: string | null;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        className="size-10 rounded-lg border border-white/10 object-cover"
        src={src}
      />
    );
  }

  return (
    <div className="flex size-10 items-center justify-center rounded-lg border border-white/10 bg-cyan-400/10 text-sm font-semibold text-cyan-100">
      {name.slice(0, 2).toUpperCase()}
    </div>
  );
}

function EvidenceBadges({ labels }: { labels: string[] }) {
  if (labels.length === 0) {
    return <span className="text-xs text-zinc-500">No labels</span>;
  }

  return (
    <div className="flex min-w-0 max-w-full flex-wrap gap-1.5">
      {labels.map((label) => (
        <span
          className={`max-w-full break-words rounded-md border px-2 py-1 text-xs leading-snug ${labelClass(label)}`}
          key={label}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function TraderIdentity({
  trader,
}: {
  trader: Pick<
    TraderSummary,
    "profileImage" | "proxyWallet" | "userName" | "verifiedBadge" | "xUsername"
  >;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <TraderAvatar name={trader.userName} src={trader.profileImage} />
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-semibold text-white">
            {trader.userName}
          </span>
          {trader.verifiedBadge ? (
            <BadgeCheck className="size-4 shrink-0 text-emerald-200" />
          ) : null}
        </div>
        <div className="font-mono text-xs text-zinc-500">
          {shortWallet(trader.proxyWallet)}
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  valueClassName = "text-white",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-black/20 p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 break-words text-lg font-semibold ${valueClassName}`}>
        {value}
      </div>
    </div>
  );
}

function Header({
  activeTab,
  canRefresh,
  onRefresh,
  onTabChange,
  requestState,
}: {
  activeTab: DashboardTab;
  canRefresh: boolean;
  onRefresh: () => void;
  onTabChange: (tab: DashboardTab) => void;
  requestState: RequestState;
}) {
  const tabs: { icon: typeof BarChart3; id: DashboardTab; label: string }[] = [
    { icon: BarChart3, id: "smart", label: "Top Traders" },
    { icon: Waves, id: "whales", label: "Whales" },
    { icon: Crosshair, id: "sharp", label: "Sharp Plays" },
    { icon: Wallet, id: "lookup", label: "Wallet Lookup" },
  ];

  return (
    <div className="border-b border-white/10 bg-[#111314]">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4 px-4 py-4 md:px-6 xl:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-400/10">
              <UserRoundSearch className="size-5 text-cyan-200" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal text-white">
                Trader Intelligence
              </h1>
              <p className="text-sm text-zinc-400">Polymarket signal desk</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
            <nav
              aria-label="Workspace"
              className="w-full max-w-full rounded-lg border border-white/10 bg-black/25 p-1 sm:w-auto"
            >
              <div className="grid min-w-0 grid-cols-3 gap-1 sm:flex sm:w-max">
                <Link
                  className="flex min-h-10 min-w-0 items-center justify-center rounded-md px-2 py-2 text-center text-sm font-medium leading-snug text-zinc-300 transition hover:bg-white/[0.08] hover:text-white sm:px-3"
                  href="/screeners"
                >
                  Screeners
                </Link>
                <Link
                  className="flex min-h-10 min-w-0 items-center justify-center rounded-md bg-cyan-300 px-2 py-2 text-center text-sm font-medium leading-snug text-black sm:px-3"
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
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              disabled={
                !canRefresh ||
                requestState === "loading" ||
                requestState === "refreshing"
              }
              onClick={onRefresh}
              type="button"
            >
              <RefreshCw className="size-4" />
              Refresh
            </button>
          </div>
        </div>

        <div className="max-w-full">
          <div className="grid min-w-0 grid-cols-2 gap-1 rounded-lg border border-white/10 bg-black/25 p-1 sm:grid-cols-4">
            {tabs.map((tab) => (
              <button
                className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-2 text-center text-sm font-medium leading-snug sm:gap-2 sm:px-4 ${
                  activeTab === tab.id
                    ? "bg-cyan-300 text-black"
                    : "text-zinc-300 hover:bg-white/[0.06]"
                }`}
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                type="button"
              >
                <tab.icon className="size-4 shrink-0" />
                <span className="min-w-0 break-words">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SignalBriefing({ activeTab }: { activeTab: DashboardTab }) {
  const copy = activeTab === "whales"
    ? {
        title: "Whale signal",
        body: "Prioritize capital size only when concentration, open PnL, and repeat activity support the exposure.",
        metrics: ["Value", "Open PnL", "Concentration"],
      }
    : activeTab === "sharp"
      ? {
          title: "Shared conviction",
          body: "Look for overlapping positions across proven traders, then check price, expiry, and participant quality.",
          metrics: ["Trader count", "Shared value", "Conviction"],
        }
      : {
          title: "Trader quality",
          body: "Score is a starting point. Durable PnL, volume context, and signal labels should explain why the trader matters.",
          metrics: ["PnL", "Volume", "PnL / Vol"],
        };

  return (
    <section className="grid gap-3 rounded-lg border border-white/10 bg-[#151718] p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div>
        <div className="text-sm font-semibold text-white">{copy.title}</div>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-zinc-400">
          {copy.body}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {copy.metrics.map((metric) => (
          <span
            className="rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-xs font-medium text-cyan-100"
            key={metric}
          >
            {metric}
          </span>
        ))}
      </div>
    </section>
  );
}

function TraderRows({
  onSelectWallet,
  requestState,
  traders,
}: {
  onSelectWallet: (wallet: string) => void;
  requestState: RequestState;
  traders: TraderSummary[];
}) {
  if (
    (requestState === "loading" || requestState === "refreshing") &&
    traders.length === 0
  ) {
    return (
      <div
        aria-atomic="true"
        className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400"
        role="status"
      >
        Loading traders...
      </div>
    );
  }

  if (traders.length === 0) {
    return (
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
        No traders matched this view.
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-black/20 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left">Trader</th>
              <th className="px-4 py-3 text-right">PnL</th>
              <th className="px-4 py-3 text-right">Volume</th>
              <th className="px-4 py-3 text-right">PnL / Vol</th>
              <th className="px-4 py-3 text-right">Score</th>
              <th className="px-4 py-3 text-left">Signals</th>
              <th className="px-4 py-3 text-right">Profile</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {traders.map((trader) => (
              <tr className="hover:bg-white/[0.03]" key={trader.proxyWallet}>
                <td className="px-4 py-3">
                  <TraderIdentity trader={trader} />
                </td>
                <td className="px-4 py-3 text-right font-mono text-emerald-200">
                  {formatMoney(trader.pnl)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-200">
                  {formatMoney(trader.volume)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-300">
                  {formatPercent(trader.pnlPerVolume)}
                </td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${scoreClass(trader.scores.alphaDogScore)}`}>
                  {trader.scores.alphaDogScore}
                </td>
                <td className="max-w-sm px-4 py-3">
                  <EvidenceBadges labels={trader.labels} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/[0.08]"
                    onClick={() => onSelectWallet(trader.proxyWallet)}
                    type="button"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid min-w-0 gap-3 p-3 md:hidden">
        {traders.map((trader) => (
          <article
            className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-4"
            key={trader.proxyWallet}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <TraderIdentity trader={trader} />
              </div>
              <div className={`shrink-0 font-mono text-lg font-semibold ${scoreClass(trader.scores.alphaDogScore)}`}>
                {trader.scores.alphaDogScore}
              </div>
            </div>
            <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <Metric label="PnL" value={formatMoney(trader.pnl)} valueClassName="text-emerald-200" />
              <Metric label="Volume" value={formatMoney(trader.volume)} />
            </div>
            <div className="mt-3 min-w-0">
              <EvidenceBadges labels={trader.labels} />
            </div>
            <button
              className="mt-4 flex min-h-10 w-full min-w-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-sm font-semibold leading-snug text-white transition hover:bg-white/[0.08]"
              onClick={() => onSelectWallet(trader.proxyWallet)}
              type="button"
            >
              View Profile
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

function WhaleRows({
  onSelectWallet,
  requestState,
  whales,
}: {
  onSelectWallet: (wallet: string) => void;
  requestState: RequestState;
  whales: WhaleCandidate[];
}) {
  if (
    (requestState === "loading" || requestState === "refreshing") &&
    whales.length === 0
  ) {
    return (
      <div
        aria-atomic="true"
        className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400"
        role="status"
      >
        Loading whale candidates...
      </div>
    );
  }

  if (whales.length === 0) {
    return (
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
        No whale candidates matched this view.
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-black/20 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left">Trader</th>
              <th className="px-4 py-3 text-right">Whale</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-right">Open PnL</th>
              <th className="px-4 py-3 text-right">Top Market</th>
              <th className="px-4 py-3 text-left">Signals</th>
              <th className="px-4 py-3 text-right">Profile</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {whales.map((whale) => (
              <tr className="hover:bg-white/[0.03]" key={whale.proxyWallet}>
                <td className="px-4 py-3">
                  <TraderIdentity trader={whale} />
                </td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${scoreClass(whale.whaleScore)}`}>
                  {whale.whaleScore}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-200">
                  {formatMoney(whale.totalValue)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-emerald-200">
                  {formatMoney(whale.openCashPnl)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-300">
                  {formatMoney(whale.topMarketValue)}
                </td>
                <td className="max-w-sm px-4 py-3">
                  <EvidenceBadges labels={whale.labels} />
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/[0.08]"
                    onClick={() => onSelectWallet(whale.proxyWallet)}
                    type="button"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid min-w-0 gap-3 p-3 md:hidden">
        {whales.map((whale) => (
          <article
            className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-4"
            key={whale.proxyWallet}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <TraderIdentity trader={whale} />
              </div>
              <div className={`shrink-0 font-mono text-lg font-semibold ${scoreClass(whale.whaleScore)}`}>
                {whale.whaleScore}
              </div>
            </div>
            <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <Metric label="Value" value={formatMoney(whale.totalValue)} />
              <Metric label="Open PnL" value={formatMoney(whale.openCashPnl)} valueClassName="text-emerald-200" />
            </div>
            <div className="mt-3 min-w-0">
              <EvidenceBadges labels={whale.labels} />
            </div>
            <button
              className="mt-4 flex min-h-10 w-full min-w-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-center text-sm font-semibold leading-snug text-white transition hover:bg-white/[0.08]"
              onClick={() => onSelectWallet(whale.proxyWallet)}
              type="button"
            >
              View Profile
            </button>
          </article>
        ))}
      </div>
    </>
  );
}

function SharpPlayRows({
  onSelectWallet,
  plays,
  requestState,
}: {
  onSelectWallet: (wallet: string) => void;
  plays: SharpPlay[];
  requestState: RequestState;
}) {
  if (
    (requestState === "loading" || requestState === "refreshing") &&
    plays.length === 0
  ) {
    return (
      <div
        aria-atomic="true"
        className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400"
        role="status"
      >
        Finding overlapping smart-trader positions...
      </div>
    );
  }

  if (plays.length === 0) {
    return (
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
        No shared positions found across three or more smart traders.
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full divide-y divide-white/10 text-sm">
          <thead className="bg-black/20 text-xs uppercase text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left">Position</th>
              <th className="px-4 py-3 text-right">Traders</th>
              <th className="px-4 py-3 text-right">Value</th>
              <th className="px-4 py-3 text-right">Open PnL</th>
              <th className="px-4 py-3 text-right">Conviction</th>
              <th className="px-4 py-3 text-left">Participants</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {plays.map((play) => (
              <tr className="hover:bg-white/[0.03]" key={play.id}>
                <td className="max-w-md px-4 py-3">
                  <div className="font-medium text-white">{play.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-zinc-400">
                    <span>{play.outcome}</span>
                    <span className="font-mono">
                      {play.curPrice > 0 ? `${Math.round(play.curPrice * 100)}c` : "n/a"}
                    </span>
                    {play.endDate ? (
                      <span>{new Date(play.endDate).toLocaleDateString()}</span>
                    ) : null}
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-200">
                  {play.traderCount}
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-200">
                  {formatMoney(play.totalValue)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-emerald-200">
                  {formatMoney(play.totalCashPnl)}
                </td>
                <td className={`px-4 py-3 text-right font-mono font-semibold ${scoreClass(play.convictionScore)}`}>
                  {play.convictionScore}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {play.traders.slice(0, 5).map((trader) => (
                      <button
                        className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-zinc-100 transition hover:bg-white/[0.08]"
                        key={trader.proxyWallet}
                        onClick={() => onSelectWallet(trader.proxyWallet)}
                        type="button"
                      >
                        {trader.userName}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid min-w-0 gap-3 p-3 md:hidden">
        {plays.map((play) => (
          <article
            className="min-w-0 overflow-hidden rounded-lg border border-white/10 bg-black/20 p-4"
            key={play.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="break-words font-semibold text-white">
                  {play.title}
                </div>
                <div className="mt-1 text-sm text-zinc-400">{play.outcome}</div>
              </div>
              <div className={`shrink-0 font-mono text-lg font-semibold ${scoreClass(play.convictionScore)}`}>
                {play.convictionScore}
              </div>
            </div>

            <div className="mt-4 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <Metric label="Smart Traders" value={formatNumber(play.traderCount)} />
              <Metric label="Shared Value" value={formatMoney(play.totalValue)} />
              <Metric label="Open PnL" value={formatMoney(play.totalCashPnl)} valueClassName="text-emerald-200" />
              <Metric label="Current Price" value={play.curPrice > 0 ? `${Math.round(play.curPrice * 100)}c` : "n/a"} />
            </div>

            <div className="mt-3 min-w-0">
              <EvidenceBadges labels={play.labels} />
            </div>

            <div className="mt-4 grid min-w-0 gap-2">
              {play.traders.slice(0, 4).map((trader) => (
                <button
                  className="flex min-h-10 min-w-0 items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-sm text-white transition hover:bg-white/[0.08]"
                  key={trader.proxyWallet}
                  onClick={() => onSelectWallet(trader.proxyWallet)}
                  type="button"
                >
                  <span className="min-w-0 truncate font-medium">
                    {trader.userName}
                  </span>
                  <span className="shrink-0 font-mono text-xs text-zinc-400">
                    {formatMoney(trader.currentValue)}
                  </span>
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export function WalletDrawer({
  loading,
  onClose,
  profile,
  wallet,
}: {
  loading: boolean;
  onClose: () => void;
  profile: TraderWalletProfile | null;
  wallet: string | null;
}) {
  if (!wallet) {
    return null;
  }

  return (
    <AccessibleOverlay
      className="bg-black/60"
      description={`Review positions, activity, and risk measures for wallet ${wallet}. Press Escape to close.`}
      label="Wallet profile"
      onClose={onClose}
    >
      <div className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-white/10 bg-[#111314] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <div className="text-sm text-zinc-400">Wallet Profile</div>
            <div className="truncate font-mono text-sm text-white">{wallet}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              aria-label="Copy wallet"
              className="inline-flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08]"
              onClick={() => void navigator.clipboard?.writeText(wallet)}
              title="Copy wallet"
              type="button"
            >
              <Copy className="size-4" />
            </button>
            <button
              aria-label="Close wallet profile"
              className="inline-flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08]"
              onClick={onClose}
              title="Close"
              type="button"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {loading || !profile ? (
          <div
            aria-atomic="true"
            className="flex flex-1 items-center justify-center text-sm text-zinc-400"
            role="status"
          >
            Loading wallet profile...
          </div>
        ) : (
          <div
            aria-label="Wallet profile details"
            className="min-h-0 flex-1 overflow-y-auto p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-cyan-300"
            tabIndex={0}
          >
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="Value" value={formatMoney(profile.totalValue)} />
              <Metric label="Open Value" value={formatMoney(profile.summary.totalOpenValue)} />
              <Metric label="Open PnL" value={formatMoney(profile.summary.openCashPnl)} valueClassName="text-emerald-200" />
              <Metric label="Score" value={String(profile.scores.alphaDogScore)} valueClassName={scoreClass(profile.scores.alphaDogScore)} />
            </div>

            <section className="mt-4 rounded-lg border border-white/10 bg-black/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-white">Risk Summary</h2>
                <span className="text-xs text-zinc-500">
                  {freshnessLabel(profile)}
                </span>
              </div>
              <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Open positions</span>
                  <span className="font-mono text-white">{profile.summary.openPositionCount}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Closed positions</span>
                  <span className="font-mono text-white">{profile.summary.closedPositionCount}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Concentration</span>
                  <span className="font-mono text-white">{formatPercent(profile.summary.concentrationRatio)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-zinc-400">Recent actions</span>
                  <span className="font-mono text-white">{profile.summary.recentActivityCount}</span>
                </div>
              </div>
            </section>

            <section className="mt-4 rounded-lg border border-white/10 bg-black/20">
              <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">
                Open Positions
              </div>
              <div className="divide-y divide-white/10">
                {profile.openPositions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-400">
                    No open positions.
                  </div>
                ) : (
                  profile.openPositions.slice(0, 8).map((position) => (
                    <div className="grid gap-2 px-4 py-3 text-sm" key={`${position.conditionId}-${position.asset}`}>
                      <div className="font-medium text-white">{position.title}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
                        <span>{position.outcome}</span>
                        <span className="font-mono">{formatMoney(position.currentValue)}</span>
                        <span className="font-mono text-emerald-200">{formatMoney(position.cashPnl)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="mt-4 rounded-lg border border-white/10 bg-black/20">
              <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">
                Recent Activity
              </div>
              <div className="divide-y divide-white/10">
                {profile.activity.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-zinc-400">
                    No recent activity.
                  </div>
                ) : (
                  profile.activity.slice(0, 10).map((item, index) => (
                    <div className="grid gap-2 px-4 py-3 text-sm" key={`${item.transactionHash ?? item.conditionId}-${index}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-medium text-white">{item.title}</div>
                        <div className="font-mono text-xs text-zinc-400">
                          {item.timestamp
                            ? new Date(item.timestamp * 1000).toLocaleDateString()
                            : "n/a"}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-zinc-400">
                        <span>{item.type}</span>
                        <span>{item.side ?? "n/a"}</span>
                        <span className="font-mono">{formatMoney(item.usdcSize)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
      </div>
    </AccessibleOverlay>
  );
}

const defaultTraderUrlState: TraderDashboardUrlState = {
  filters: defaultTraderFilters,
  tab: "smart",
  wallet: "",
};

export function TraderIntelligence() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("smart");
  const [draftFilters, setDraftFilters] =
    useState<TraderAppliedFilters>(defaultTraderFilters);
  const [appliedFilters, setAppliedFilters] =
    useState<TraderAppliedFilters>(defaultTraderFilters);
  const [leaderboard, setLeaderboard] =
    useState<PolymarketLeaderboardResponse | null>(null);
  const [whales, setWhales] = useState<PolymarketWhalesResponse | null>(null);
  const [sharpPlays, setSharpPlays] =
    useState<PolymarketSharpPlaysResponse | null>(null);
  const [request, dispatchRequest] = useAsyncRequestState();
  const requestState = request.listState;
  const listError = request.listError;
  const profileError = request.profileError;
  const profileLoading = request.profileLoading;
  const [lookupWallet, setLookupWallet] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] =
    useState<TraderWalletProfile | null>(null);
  const [profileRequestRevision, setProfileRequestRevision] = useState(0);
  const [resultFilters, setResultFilters] =
    useState<Partial<Record<DashboardTab, TraderAppliedFilters>>>({});
  const [urlReady, setUrlReady] = useState(false);
  const listLifecycle = useRef(new LatestRequestLifecycle());
  const profileLifecycle = useRef(new LatestRequestLifecycle());
  const selectedWalletRef = useRef<string | null>(null);

  const params = useMemo(() => {
    const searchParams = new URLSearchParams({
      category: appliedFilters.category,
      limit: String(appliedFilters.limit),
      orderBy: appliedFilters.orderBy,
      timePeriod: appliedFilters.timePeriod,
    });

    return searchParams;
  }, [appliedFilters]);

  const loadLeaderboard = useCallback(async (forceRefresh = false) => {
    const token = listLifecycle.current.begin();
    dispatchRequest({ type: "list/start" });

    try {
      const nextParams = new URLSearchParams(params);
      if (forceRefresh) {
        nextParams.set("forceRefresh", "true");
      }

      const response = await fetch(`/api/polymarket/leaderboard?${nextParams}`, {
        cache: "no-store",
        signal: token.signal,
      });
      const payload = await response.json() as
        | PolymarketLeaderboardResponse
        | ApiErrorPayload;

      if (!response.ok || isApiErrorPayload(payload)) {
        throw new Error(
          isApiErrorPayload(payload)
            ? payload.error.message
            : "Unable to load trader leaderboard.",
        );
      }

      listLifecycle.current.commit(token, () => {
        setLeaderboard(payload);
        setResultFilters((current) => ({
          ...current,
          smart: appliedFilters,
        }));
        dispatchRequest({ type: "list/success" });
      });
    } catch (caught) {
      if (isAbortError(caught) || !listLifecycle.current.isActive(token)) {
        return;
      }

      listLifecycle.current.commit(token, () => {
        dispatchRequest({
          type: "list/error",
          message: caught instanceof Error
            ? caught.message
            : "Unable to load trader leaderboard.",
        });
      });
    } finally {
      listLifecycle.current.finish(token);
    }
  }, [appliedFilters, dispatchRequest, params]);

  const loadWhales = useCallback(async (forceRefresh = false) => {
    const token = listLifecycle.current.begin();
    dispatchRequest({ type: "list/start" });

    try {
      const nextParams = new URLSearchParams(params);
      nextParams.set("minValue", String(appliedFilters.minValue));
      if (forceRefresh) {
        nextParams.set("forceRefresh", "true");
      }

      const response = await fetch(`/api/polymarket/whales?${nextParams}`, {
        cache: "no-store",
        signal: token.signal,
      });
      const payload = await response.json() as
        | PolymarketWhalesResponse
        | ApiErrorPayload;

      if (!response.ok || isApiErrorPayload(payload)) {
        throw new Error(
          isApiErrorPayload(payload)
            ? payload.error.message
            : "Unable to load whale candidates.",
        );
      }

      listLifecycle.current.commit(token, () => {
        setWhales(payload);
        setResultFilters((current) => ({
          ...current,
          whales: appliedFilters,
        }));
        dispatchRequest({ type: "list/success" });
      });
    } catch (caught) {
      if (isAbortError(caught) || !listLifecycle.current.isActive(token)) {
        return;
      }

      listLifecycle.current.commit(token, () => {
        dispatchRequest({
          type: "list/error",
          message: caught instanceof Error
            ? caught.message
            : "Unable to load whale candidates.",
        });
      });
    } finally {
      listLifecycle.current.finish(token);
    }
  }, [appliedFilters, dispatchRequest, params]);

  const loadSharpPlays = useCallback(async (forceRefresh = false) => {
    const token = listLifecycle.current.begin();
    dispatchRequest({ type: "list/start" });

    try {
      const nextParams = new URLSearchParams(params);
      nextParams.set("minTraders", "3");
      if (forceRefresh) {
        nextParams.set("forceRefresh", "true");
      }

      const response = await fetch(`/api/polymarket/sharp-plays?${nextParams}`, {
        cache: "no-store",
        signal: token.signal,
      });
      const payload = await response.json() as
        | PolymarketSharpPlaysResponse
        | ApiErrorPayload;

      if (!response.ok || isApiErrorPayload(payload)) {
        throw new Error(
          isApiErrorPayload(payload)
            ? payload.error.message
            : "Unable to load sharp plays.",
        );
      }

      listLifecycle.current.commit(token, () => {
        setSharpPlays(payload);
        setResultFilters((current) => ({
          ...current,
          sharp: appliedFilters,
        }));
        dispatchRequest({ type: "list/success" });
      });
    } catch (caught) {
      if (isAbortError(caught) || !listLifecycle.current.isActive(token)) {
        return;
      }

      listLifecycle.current.commit(token, () => {
        dispatchRequest({
          type: "list/error",
          message: caught instanceof Error
            ? caught.message
            : "Unable to load sharp plays.",
        });
      });
    } finally {
      listLifecycle.current.finish(token);
    }
  }, [appliedFilters, dispatchRequest, params]);

  const loadWalletProfile = useCallback(async (
    wallet: string,
    forceRefresh = false,
  ) => {
    const token = profileLifecycle.current.begin();
    dispatchRequest({ type: "profile/start" });

    try {
      const response = await fetch(
        `/api/polymarket/traders/${encodeURIComponent(wallet)}${
          forceRefresh ? "?forceRefresh=true" : ""
        }`,
        {
          cache: "no-store",
          signal: token.signal,
        },
      );
      const payload = await response.json() as
        | TraderWalletProfile
        | ApiErrorPayload;

      if (!response.ok || isApiErrorPayload(payload)) {
        throw new Error(
          isApiErrorPayload(payload)
            ? payload.error.message
            : "Unable to load wallet profile.",
        );
      }

      profileLifecycle.current.commit(token, () => {
        setSelectedProfile(payload);
      });
    } catch (caught) {
      if (isAbortError(caught) || !profileLifecycle.current.isActive(token)) {
        return;
      }

      profileLifecycle.current.commit(token, () => {
        dispatchRequest({
          type: "profile/error",
          message: caught instanceof Error
            ? caught.message
            : "Unable to load wallet profile.",
        });
      });
    } finally {
      profileLifecycle.current.commit(token, () => {
        dispatchRequest({ type: "profile/success" });
      });
      profileLifecycle.current.finish(token);
    }
  }, [dispatchRequest]);

  useEffect(() => {
    const listRequests = listLifecycle.current;
    const profileRequests = profileLifecycle.current;

    function restoreFromUrl() {
      const restored = parseTraderDashboardState(
        window.location.search,
        defaultTraderUrlState,
      );

      listRequests.abort();
      profileRequests.abort();
      setActiveTab(restored.tab);
      setDraftFilters(restored.filters);
      setAppliedFilters(restored.filters);
      setLookupWallet(restored.wallet);
      const nextWallet = walletPattern.test(restored.wallet)
        ? restored.wallet
        : null;
      if (selectedWalletRef.current !== nextWallet) {
        setSelectedProfile(null);
      }
      selectedWalletRef.current = nextWallet;
      setSelectedWallet(nextWallet);
      if (nextWallet) {
        setProfileRequestRevision((current) => current + 1);
      }
      dispatchRequest({ type: "list/reset" });
      dispatchRequest({ type: "profile/reset" });
      setUrlReady(true);
    }

    restoreFromUrl();
    window.addEventListener("popstate", restoreFromUrl);

    return () => {
      window.removeEventListener("popstate", restoreFromUrl);
      listRequests.abort();
      profileRequests.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!urlReady || activeTab === "lookup") {
      return;
    }

    const loadTimer = window.setTimeout(() => {
      if (activeTab === "smart") {
        void loadLeaderboard();
      } else if (activeTab === "whales") {
        void loadWhales();
      } else {
        void loadSharpPlays();
      }
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [
    activeTab,
    appliedFilters,
    loadLeaderboard,
    loadSharpPlays,
    loadWhales,
    urlReady,
  ]);

  useEffect(() => {
    if (!urlReady || !selectedWallet) {
      return;
    }

    const loadTimer = window.setTimeout(() => {
      void loadWalletProfile(selectedWallet);
    }, 0);

    return () => window.clearTimeout(loadTimer);
  }, [
    loadWalletProfile,
    profileRequestRevision,
    selectedWallet,
    urlReady,
  ]);

  function writeDashboardUrl(
    state: TraderDashboardUrlState,
    mode: "push" | "replace" = "push",
  ) {
    const query = serializeTraderDashboardState(state).toString();
    const nextUrl = `${window.location.pathname}?${query}`;

    if (`${window.location.pathname}${window.location.search}` === nextUrl) {
      return;
    }

    window.history[mode === "push" ? "pushState" : "replaceState"](
      null,
      "",
      nextUrl,
    );
  }

  function handleTabChange(tab: DashboardTab) {
    if (tab === "lookup") {
      listLifecycle.current.abort();
      dispatchRequest({ type: "list/reset" });
    }

    setActiveTab(tab);
    writeDashboardUrl({
      filters: appliedFilters,
      tab,
      wallet: selectedWallet ?? "",
    });
  }

  function handleApplyFilters() {
    setAppliedFilters(draftFilters);
    writeDashboardUrl({
      filters: draftFilters,
      tab: activeTab,
      wallet: selectedWallet ?? "",
    });
  }

  function handleSelectWallet(wallet: string) {
    const normalizedWallet = wallet.toLowerCase();

    if (selectedWalletRef.current !== normalizedWallet) {
      setSelectedProfile(null);
    } else {
      setProfileRequestRevision((current) => current + 1);
    }
    selectedWalletRef.current = normalizedWallet;
    dispatchRequest({ type: "profile/reset" });
    setSelectedWallet(normalizedWallet);
    setLookupWallet(normalizedWallet);
    writeDashboardUrl({
      filters: appliedFilters,
      tab: activeTab,
      wallet: normalizedWallet,
    });
  }

  function handleRefresh() {
    if (activeTab === "whales") {
      void loadWhales(true);
      return;
    }

    if (activeTab === "sharp") {
      void loadSharpPlays(true);
      return;
    }

    if (activeTab === "lookup" && selectedWallet) {
      void loadWalletProfile(selectedWallet, true);
      return;
    }

    void loadLeaderboard(true);
  }

  function handleLookupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const wallet = lookupWallet.trim();

    if (walletPattern.test(wallet)) {
      listLifecycle.current.abort();
      dispatchRequest({ type: "list/reset" });
      handleSelectWallet(wallet);
    }
  }

  const totalPnl = leaderboard?.traders.reduce(
    (total, trader) => total + trader.pnl,
    0,
  ) ?? 0;
  const totalVolume = leaderboard?.traders.reduce(
    (total, trader) => total + trader.volume,
    0,
  ) ?? 0;
  const topScore = leaderboard?.traders.reduce(
    (max, trader) => Math.max(max, trader.scores.alphaDogScore),
    0,
  ) ?? 0;
  const hasUnappliedFilterChanges =
    JSON.stringify(draftFilters) !== JSON.stringify(appliedFilters);
  const leaderboardFilters = resultFilters.smart ?? appliedFilters;
  const whaleFilters = resultFilters.whales ?? appliedFilters;
  const sharpFilters = resultFilters.sharp ?? appliedFilters;
  const visibleError = profileError && selectedWallet
    ? profileError
    : activeTab === "lookup"
      ? null
      : listError;

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0b0c0d] text-zinc-100">
      <Header
        activeTab={activeTab}
        canRefresh={activeTab !== "lookup" || Boolean(selectedWallet)}
        onRefresh={handleRefresh}
        onTabChange={handleTabChange}
        requestState={requestState}
      />

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-5 md:px-6 xl:px-8">
        {activeTab !== "lookup" ? (
          <>
            <FilterControls
              appliedFilters={appliedFilters}
              category={draftFilters.category}
              hasUnappliedChanges={hasUnappliedFilterChanges}
              limit={draftFilters.limit}
              minValue={draftFilters.minValue}
              onApply={handleApplyFilters}
              onCategoryChange={(category) =>
                setDraftFilters((current) => ({ ...current, category }))}
              onLimitChange={(limit) =>
                setDraftFilters((current) => ({ ...current, limit }))}
              onMinValueChange={(minValue) =>
                setDraftFilters((current) => ({ ...current, minValue }))}
              onOrderByChange={(orderBy) =>
                setDraftFilters((current) => ({ ...current, orderBy }))}
              onTimePeriodChange={(timePeriod) =>
                setDraftFilters((current) => ({ ...current, timePeriod }))}
              orderBy={draftFilters.orderBy}
              showMinValue={activeTab === "whales"}
              timePeriod={draftFilters.timePeriod}
            />
            <SignalBriefing activeTab={activeTab} />
          </>
        ) : (
          <form
            className="grid gap-3 rounded-lg border border-white/10 bg-[#151718] p-4 md:grid-cols-[minmax(260px,1fr)_auto]"
            onSubmit={handleLookupSubmit}
          >
            <label className="grid gap-1.5 text-sm">
              <span className="text-zinc-400">Wallet Address</span>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3">
                <Search className="size-4 text-zinc-500" />
                <input
                  className="w-full bg-transparent font-mono text-sm text-white outline-none"
                  onChange={(event) => setLookupWallet(event.target.value)}
                  placeholder="0x..."
                  value={lookupWallet}
                />
              </div>
            </label>
            <button
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-cyan-300 px-4 text-sm font-semibold text-black transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60 md:self-end"
              disabled={!walletPattern.test(lookupWallet.trim())}
              type="submit"
            >
              <Target className="size-4" />
              Analyze Wallet
            </button>
          </form>
        )}

        {visibleError ? (
          <div
            aria-atomic="true"
            className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100"
            role="alert"
          >
            {visibleError}
          </div>
        ) : null}

        {activeTab === "smart" ? (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <Metric label="Observed PnL" value={formatMoney(totalPnl)} valueClassName="text-emerald-200" />
              <Metric label="Observed Volume" value={formatMoney(totalVolume)} />
              <Metric label="Top Score" value={String(topScore)} valueClassName={scoreClass(topScore)} />
            </section>
            <ListPresentation filterLabel={appliedFilterLabel(leaderboardFilters)} freshness={freshnessLabel(leaderboard)} icon={<TrendingUp className="size-4 text-emerald-200" />} title="Smart Traders">
              <TraderRows
                onSelectWallet={handleSelectWallet}
                requestState={requestState}
                traders={leaderboard?.traders ?? []}
              />
            </ListPresentation>
          </>
        ) : null}

        {activeTab === "whales" ? (
          <ListPresentation filterLabel={appliedFilterLabel(whaleFilters)} freshness={freshnessLabel(whales)} icon={<Waves className="size-4 text-cyan-200" />} title="Whale Edge">
            <WhaleRows
              onSelectWallet={handleSelectWallet}
              requestState={requestState}
              whales={whales?.whales ?? []}
            />
          </ListPresentation>
        ) : null}

        {activeTab === "sharp" ? (
          <ListPresentation filterLabel={appliedFilterLabel(sharpFilters)} freshness={freshnessLabel(sharpPlays)} icon={<Crosshair className="size-4 text-cyan-200" />} title="Sharp Plays">
            <SharpPlayRows
              onSelectWallet={handleSelectWallet}
              plays={sharpPlays?.plays ?? []}
              requestState={requestState}
            />
          </ListPresentation>
        ) : null}

        {activeTab === "lookup" && selectedProfile ? (
          <section className="grid gap-3 md:grid-cols-4">
            <Metric label="Value" value={formatMoney(selectedProfile.totalValue)} />
            <Metric label="Open PnL" value={formatMoney(selectedProfile.summary.openCashPnl)} valueClassName="text-emerald-200" />
            <Metric label="Positions" value={formatNumber(selectedProfile.summary.openPositionCount)} />
            <Metric label="Score" value={String(selectedProfile.scores.alphaDogScore)} valueClassName={scoreClass(selectedProfile.scores.alphaDogScore)} />
          </section>
        ) : null}
      </div>

      <WalletDrawer
        loading={profileLoading}
        onClose={() => {
          profileLifecycle.current.abort();
          selectedWalletRef.current = null;
          setSelectedWallet(null);
          setSelectedProfile(null);
          dispatchRequest({ type: "profile/reset" });
          writeDashboardUrl({
            filters: appliedFilters,
            tab: activeTab,
            wallet: "",
          });
        }}
        profile={selectedProfile}
        wallet={selectedWallet}
      />
    </main>
  );
}
