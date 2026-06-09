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
import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  PolymarketCategory,
  PolymarketLeaderboardResponse,
  PolymarketOrderBy,
  PolymarketSharpPlaysResponse,
  PolymarketTimePeriod,
  PolymarketWhalesResponse,
  SharpPlay,
  TraderSummary,
  TraderWalletProfile,
  WhaleCandidate,
} from "@/lib/polymarket/types";
import {
  polymarketCategories,
  polymarketOrderByValues,
  polymarketTimePeriods,
} from "@/lib/polymarket/types";

type DashboardTab = "smart" | "whales" | "sharp" | "lookup";
type RequestState = "idle" | "loading" | "refreshing" | "success" | "error";

interface ApiErrorPayload {
  error: {
    message: string;
  };
}

const walletPattern = /^0x[a-fA-F0-9]{40}$/;

function isApiErrorPayload(payload: unknown): payload is ApiErrorPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error?.message === "string"
  );
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    style: "currency",
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPercent(value: number | null) {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${(value * 100).toFixed(2)}%`;
}

function shortWallet(wallet: string) {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

function scoreClass(score: number) {
  if (score >= 75) {
    return "text-emerald-200";
  }

  if (score >= 55) {
    return "text-cyan-200";
  }

  return "text-amber-200";
}

function labelClass(label: string) {
  if (label === "Capital with edge" || label === "Recent momentum") {
    return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  }

  if (label === "Concentrated exposure" || label === "Thin evidence") {
    return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  }

  return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
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
    { icon: BarChart3, id: "smart", label: "Smart Traders" },
    { icon: Waves, id: "whales", label: "Whale Edge" },
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

function Filters({
  category,
  limit,
  minValue,
  onCategoryChange,
  onLimitChange,
  onMinValueChange,
  onOrderByChange,
  onTimePeriodChange,
  orderBy,
  showMinValue,
  timePeriod,
}: {
  category: PolymarketCategory;
  limit: number;
  minValue: number;
  onCategoryChange: (category: PolymarketCategory) => void;
  onLimitChange: (limit: number) => void;
  onMinValueChange: (value: number) => void;
  onOrderByChange: (orderBy: PolymarketOrderBy) => void;
  onTimePeriodChange: (period: PolymarketTimePeriod) => void;
  orderBy: PolymarketOrderBy;
  showMinValue: boolean;
  timePeriod: PolymarketTimePeriod;
}) {
  return (
    <section className="grid gap-3 rounded-lg border border-white/10 bg-[#151718] p-4 md:grid-cols-4 xl:grid-cols-5">
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Category</span>
        <select
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          onChange={(event) =>
            onCategoryChange(event.target.value as PolymarketCategory)}
          value={category}
        >
          {polymarketCategories.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Period</span>
        <select
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          onChange={(event) =>
            onTimePeriodChange(event.target.value as PolymarketTimePeriod)}
          value={timePeriod}
        >
          {polymarketTimePeriods.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Rank By</span>
        <select
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          onChange={(event) =>
            onOrderByChange(event.target.value as PolymarketOrderBy)}
          value={orderBy}
        >
          {polymarketOrderByValues.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">
        <span className="text-zinc-400">Rows</span>
        <input
          className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
          max={50}
          min={1}
          onChange={(event) => onLimitChange(Number(event.target.value))}
          type="number"
          value={limit}
        />
      </label>
      {showMinValue ? (
        <label className="grid gap-1.5 text-sm">
          <span className="text-zinc-400">Min Value</span>
          <input
            className="h-10 rounded-lg border border-white/10 bg-black/30 px-3 text-white outline-none"
            min={0}
            onChange={(event) => onMinValueChange(Number(event.target.value))}
            step={1000}
            type="number"
            value={minValue}
          />
        </label>
      ) : null}
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
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
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
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
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
      <div className="border-t border-white/10 px-5 py-12 text-center text-sm text-zinc-400">
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

function WalletDrawer({
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
    <div className="fixed inset-0 z-50 bg-black/60">
      <div className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-white/10 bg-[#111314] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-white/10 p-4">
          <div className="min-w-0">
            <div className="text-sm text-zinc-400">Wallet Profile</div>
            <div className="truncate font-mono text-sm text-white">{wallet}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="inline-flex size-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-zinc-200 transition hover:bg-white/[0.08]"
              onClick={() => void navigator.clipboard?.writeText(wallet)}
              title="Copy wallet"
              type="button"
            >
              <Copy className="size-4" />
            </button>
            <button
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
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
            Loading wallet profile...
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
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
    </div>
  );
}

export function TraderIntelligence() {
  const [activeTab, setActiveTab] = useState<DashboardTab>("smart");
  const [category, setCategory] = useState<PolymarketCategory>("OVERALL");
  const [timePeriod, setTimePeriod] = useState<PolymarketTimePeriod>("WEEK");
  const [orderBy, setOrderBy] = useState<PolymarketOrderBy>("PNL");
  const [limit, setLimit] = useState(25);
  const [minValue, setMinValue] = useState(10000);
  const [leaderboard, setLeaderboard] =
    useState<PolymarketLeaderboardResponse | null>(null);
  const [whales, setWhales] = useState<PolymarketWhalesResponse | null>(null);
  const [sharpPlays, setSharpPlays] =
    useState<PolymarketSharpPlaysResponse | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lookupWallet, setLookupWallet] = useState("");
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] =
    useState<TraderWalletProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  const params = useMemo(() => {
    const searchParams = new URLSearchParams({
      category,
      limit: String(limit),
      orderBy,
      timePeriod,
    });

    return searchParams;
  }, [category, limit, orderBy, timePeriod]);

  const loadLeaderboard = useCallback(async (forceRefresh = false) => {
    setRequestState((current) => current === "success" ? "refreshing" : "loading");
    setError(null);

    try {
      const nextParams = new URLSearchParams(params);
      if (forceRefresh) {
        nextParams.set("forceRefresh", "true");
      }

      const response = await fetch(`/api/polymarket/leaderboard?${nextParams}`, {
        cache: "no-store",
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

      setLeaderboard(payload);
      setRequestState("success");
    } catch (caught) {
      setRequestState("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load trader leaderboard.",
      );
    }
  }, [params]);

  const loadWhales = useCallback(async (forceRefresh = false) => {
    setRequestState((current) => current === "success" ? "refreshing" : "loading");
    setError(null);

    try {
      const nextParams = new URLSearchParams(params);
      nextParams.set("minValue", String(minValue));
      if (forceRefresh) {
        nextParams.set("forceRefresh", "true");
      }

      const response = await fetch(`/api/polymarket/whales?${nextParams}`, {
        cache: "no-store",
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

      setWhales(payload);
      setRequestState("success");
    } catch (caught) {
      setRequestState("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to load whale candidates.",
      );
    }
  }, [minValue, params]);

  const loadSharpPlays = useCallback(async (forceRefresh = false) => {
    setRequestState((current) => current === "success" ? "refreshing" : "loading");
    setError(null);

    try {
      const nextParams = new URLSearchParams(params);
      nextParams.set("minTraders", "3");
      if (forceRefresh) {
        nextParams.set("forceRefresh", "true");
      }

      const response = await fetch(`/api/polymarket/sharp-plays?${nextParams}`, {
        cache: "no-store",
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

      setSharpPlays(payload);
      setRequestState("success");
    } catch (caught) {
      setRequestState("error");
      setError(
        caught instanceof Error ? caught.message : "Unable to load sharp plays.",
      );
    }
  }, [params]);

  const loadWalletProfile = useCallback(async (
    wallet: string,
    forceRefresh = false,
  ) => {
    setSelectedWallet(wallet);
    setSelectedProfile(null);
    setProfileLoading(true);

    try {
      const response = await fetch(
        `/api/polymarket/traders/${encodeURIComponent(wallet)}${
          forceRefresh ? "?forceRefresh=true" : ""
        }`,
        { cache: "no-store" },
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

      setSelectedProfile(payload);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to load wallet profile.",
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => {
    let loadTimer: number | null = null;

    if (activeTab === "smart") {
      loadTimer = window.setTimeout(() => {
        void loadLeaderboard();
      }, 0);
    }

    if (activeTab === "whales") {
      loadTimer = window.setTimeout(() => {
        void loadWhales();
      }, 0);
    }

    if (activeTab === "sharp") {
      loadTimer = window.setTimeout(() => {
        void loadSharpPlays();
      }, 0);
    }

    return () => {
      if (loadTimer) {
        window.clearTimeout(loadTimer);
      }
    };
  }, [activeTab, loadLeaderboard, loadSharpPlays, loadWhales]);

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
      void loadWalletProfile(wallet.toLowerCase());
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

  return (
    <main className="min-h-screen overflow-x-hidden bg-[#0b0c0d] text-zinc-100">
      <Header
        activeTab={activeTab}
        canRefresh={activeTab !== "lookup" || Boolean(selectedWallet)}
        onRefresh={handleRefresh}
        onTabChange={setActiveTab}
        requestState={requestState}
      />

      <div className="mx-auto grid max-w-[1600px] gap-4 px-4 py-5 md:px-6 xl:px-8">
        {activeTab !== "lookup" ? (
          <Filters
            category={category}
            limit={limit}
            minValue={minValue}
            onCategoryChange={setCategory}
            onLimitChange={setLimit}
            onMinValueChange={setMinValue}
            onOrderByChange={setOrderBy}
            onTimePeriodChange={setTimePeriod}
            orderBy={orderBy}
            showMinValue={activeTab === "whales"}
            timePeriod={timePeriod}
          />
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
              disabled={!walletPattern.test(lookupWallet.trim()) || profileLoading}
              type="submit"
            >
              <Target className="size-4" />
              Analyze Wallet
            </button>
          </form>
        )}

        {error ? (
          <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {activeTab === "smart" ? (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <Metric label="Observed PnL" value={formatMoney(totalPnl)} valueClassName="text-emerald-200" />
              <Metric label="Observed Volume" value={formatMoney(totalVolume)} />
              <Metric label="Top Score" value={String(topScore)} valueClassName={scoreClass(topScore)} />
            </section>
            <section className="overflow-hidden rounded-lg border border-white/10 bg-[#151718]">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <TrendingUp className="size-4 text-emerald-200" />
                  Smart Traders
                </div>
                <div className="text-xs text-zinc-500">
                  {freshnessLabel(leaderboard)}
                </div>
              </div>
              <TraderRows
                onSelectWallet={(wallet) => void loadWalletProfile(wallet)}
                requestState={requestState}
                traders={leaderboard?.traders ?? []}
              />
            </section>
          </>
        ) : null}

        {activeTab === "whales" ? (
          <section className="overflow-hidden rounded-lg border border-white/10 bg-[#151718]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Waves className="size-4 text-cyan-200" />
                Whale Edge
              </div>
              <div className="text-xs text-zinc-500">
                {freshnessLabel(whales)}
              </div>
            </div>
            <WhaleRows
              onSelectWallet={(wallet) => void loadWalletProfile(wallet)}
              requestState={requestState}
              whales={whales?.whales ?? []}
            />
          </section>
        ) : null}

        {activeTab === "sharp" ? (
          <section className="overflow-hidden rounded-lg border border-white/10 bg-[#151718]">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Crosshair className="size-4 text-cyan-200" />
                Sharp Plays
              </div>
              <div className="text-xs text-zinc-500">
                {freshnessLabel(sharpPlays)}
              </div>
            </div>
            <SharpPlayRows
              onSelectWallet={(wallet) => void loadWalletProfile(wallet)}
              plays={sharpPlays?.plays ?? []}
              requestState={requestState}
            />
          </section>
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
          setSelectedWallet(null);
          setSelectedProfile(null);
        }}
        profile={selectedProfile}
        wallet={selectedWallet}
      />
    </main>
  );
}
