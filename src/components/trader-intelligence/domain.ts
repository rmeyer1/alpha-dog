import type { TraderAppliedFilters } from "@/lib/dashboard-url-state";

export const walletPattern = /^0x[a-fA-F0-9]{40}$/;

export const defaultTraderFilters: TraderAppliedFilters = {
  category: "OVERALL",
  limit: 25,
  minValue: 10000,
  orderBy: "PNL",
  timePeriod: "WEEK",
};

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 2,
    style: "currency",
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    value,
  );
}

export function formatPercent(value: number | null) {
  return value == null || !Number.isFinite(value)
    ? "n/a"
    : `${(value * 100).toFixed(2)}%`;
}

export function shortWallet(wallet: string) {
  return `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
}

export function scoreClass(score: number) {
  return score >= 75
    ? "text-emerald-200"
    : score >= 55
      ? "text-cyan-200"
      : "text-amber-200";
}

export function labelClass(label: string) {
  if (label === "Capital with edge" || label === "Recent momentum")
    return "border-emerald-300/30 bg-emerald-400/10 text-emerald-100";
  if (label === "Concentrated exposure" || label === "Thin evidence")
    return "border-amber-300/30 bg-amber-400/10 text-amber-100";
  return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
}

export function appliedFilterLabel(filters: TraderAppliedFilters) {
  return `${filters.category} · ${filters.timePeriod} · ${filters.orderBy} · ${filters.limit} rows`;
}
