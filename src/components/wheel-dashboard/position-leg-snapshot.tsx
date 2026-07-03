import type { OptionType, SpreadLeg } from "@/lib/wheel/types";
import type { ReactNode } from "react";
import {
  formatCompactNumber,
  formatCurrency,
  formatPercent,
} from "./formatters";

type LegSide = "long" | "short";

export interface PositionLegSnapshotData {
  askPrice: number | null;
  bidPrice: number | null;
  contractSymbol: string | null;
  delta: number | null;
  expirationDate: string | null;
  impliedVolatility: number | null;
  midPrice: number | null;
  openInterest: number | null;
  openPrice?: number | null;
  optionType: OptionType | null;
  quantity?: number | null;
  side: LegSide;
  strike: number | null;
  theta: number | null;
  volume: number | null;
}

export interface SavedPositionLegSnapshot {
  askPrice: number | null;
  bidPrice: number | null;
  contractSymbol: string | null;
  delta: number | null;
  expirationDate: string | null;
  impliedVolatility: number | null;
  midPrice: number | null;
  openInterest: number | null;
  openPrice: number | null;
  optionType: OptionType | null;
  quantity: number | null;
  side: LegSide;
  strike: number | null;
  theta: number | null;
  volume: number | null;
}

export function legSnapshotFromSpreadLeg({
  expirationDate,
  leg,
  optionType,
  side,
}: {
  expirationDate: string | null;
  leg: SpreadLeg;
  optionType: OptionType | null;
  side: LegSide;
}): PositionLegSnapshotData {
  return {
    askPrice: leg.ask,
    bidPrice: leg.bid,
    contractSymbol: leg.contractSymbol,
    delta: leg.delta,
    expirationDate,
    impliedVolatility: leg.impliedVolatility,
    midPrice: leg.midpoint,
    openInterest: leg.openInterest,
    optionType,
    side,
    strike: leg.strike,
    theta: leg.theta,
    volume: leg.volume,
  };
}

export function legSnapshotFromSavedLeg(
  leg: SavedPositionLegSnapshot,
): PositionLegSnapshotData {
  return {
    askPrice: leg.askPrice,
    bidPrice: leg.bidPrice,
    contractSymbol: leg.contractSymbol,
    delta: leg.delta,
    expirationDate: leg.expirationDate,
    impliedVolatility: leg.impliedVolatility,
    midPrice: leg.midPrice,
    openInterest: leg.openInterest,
    openPrice: leg.openPrice,
    optionType: leg.optionType,
    quantity: leg.quantity,
    side: leg.side,
    strike: leg.strike,
    theta: leg.theta,
    volume: leg.volume,
  };
}

export function unavailableLabel(value: number | string | null | undefined) {
  return value == null ? "Unavailable" : String(value);
}

function actionLabel(side: LegSide) {
  return side === "short" ? "Sell to open" : "Buy to open";
}

function sideTone(side: LegSide) {
  return side === "short"
    ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
    : "border-cyan-300/25 bg-cyan-300/10 text-cyan-100";
}

function unavailable() {
  return <span className="text-zinc-500">{unavailableLabel(null)}</span>;
}

function numberText(value: number | null | undefined, digits = 2) {
  if (value == null) {
    return unavailable();
  }

  return value.toFixed(digits);
}

function priceText(value: number | null | undefined) {
  if (value == null) {
    return unavailable();
  }

  return formatCurrency(value);
}

function percentText(value: number | null | undefined) {
  if (value == null) {
    return unavailable();
  }

  return formatPercent(value);
}

function compactNumberText(value: number | null | undefined) {
  if (value == null) {
    return unavailable();
  }

  return formatCompactNumber(value);
}

function optionTypeText(value: OptionType | null) {
  if (!value) {
    return unavailable();
  }

  return value.toUpperCase();
}

function LegMetric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <dt className="text-[11px] font-medium uppercase text-zinc-500">
        {label}
      </dt>
      <dd className="font-mono text-xs text-zinc-100">{value}</dd>
    </div>
  );
}

function legTitle(leg: PositionLegSnapshotData) {
  const strike = leg.strike == null ? "Unknown strike" : formatCurrency(leg.strike);
  const type = leg.optionType ? leg.optionType.toUpperCase() : "OPTION";

  return `${strike} ${type}`;
}

function PositionLegSnapshotBody({ leg }: { leg: PositionLegSnapshotData }) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      <LegMetric label="Strike" value={priceText(leg.strike)} />
      <LegMetric label="Expiration" value={leg.expirationDate ?? unavailable()} />
      <LegMetric label="Option type" value={optionTypeText(leg.optionType)} />
      <LegMetric label="Bid" value={priceText(leg.bidPrice)} />
      <LegMetric label="Ask" value={priceText(leg.askPrice)} />
      <LegMetric label="Midpoint" value={priceText(leg.midPrice)} />
      <LegMetric label="Open price" value={priceText(leg.openPrice ?? leg.midPrice)} />
      <LegMetric label="Delta" value={numberText(leg.delta)} />
      <LegMetric label="Theta" value={numberText(leg.theta, 3)} />
      <LegMetric label="IV" value={percentText(leg.impliedVolatility)} />
      <LegMetric label="Volume" value={compactNumberText(leg.volume)} />
      <LegMetric label="Open interest" value={compactNumberText(leg.openInterest)} />
      <LegMetric
        label="Quantity"
        value={leg.quantity == null ? unavailable() : String(leg.quantity)}
      />
    </dl>
  );
}

function PositionLegSnapshotCard({
  defaultOpen,
  leg,
}: {
  defaultOpen: boolean;
  leg: PositionLegSnapshotData;
}) {
  return (
    <details
      className="group rounded-lg border border-white/10 bg-white/[0.035] p-3"
      open={defaultOpen}
    >
      <summary
        aria-label={`${actionLabel(leg.side)} ${legTitle(leg)} details`}
        className="flex cursor-pointer list-none items-start justify-between gap-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
      >
        <span className="min-w-0">
          <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${sideTone(leg.side)}`}>
            {actionLabel(leg.side)}
          </span>
          <span className="mt-2 block font-mono text-sm text-white">
            {legTitle(leg)}
          </span>
          <span className="mt-1 block truncate text-xs text-zinc-500">
            {leg.contractSymbol ?? "No contract symbol"}
          </span>
        </span>
        <span className="shrink-0 pt-1 text-xs text-zinc-500 group-open:hidden">
          Expand
        </span>
        <span className="hidden shrink-0 pt-1 text-xs text-zinc-500 group-open:block">
          Collapse
        </span>
      </summary>
      <PositionLegSnapshotBody leg={leg} />
    </details>
  );
}

export function PositionLegSnapshotList({
  defaultOpen = false,
  legs,
}: {
  defaultOpen?: boolean;
  legs: PositionLegSnapshotData[];
}) {
  if (legs.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-500">
        No leg snapshots available.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {legs.map((leg, index) => (
        <PositionLegSnapshotCard
          defaultOpen={defaultOpen}
          key={`${leg.side}-${leg.contractSymbol ?? index}`}
          leg={leg}
        />
      ))}
    </div>
  );
}
