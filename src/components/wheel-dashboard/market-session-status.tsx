import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import {
  getUsEquitiesMarketState,
  type UsEquitiesMarketState,
} from "@/lib/market/us-equities-calendar";

export interface MarketSessionView {
  detail: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  tone: {
    border: string;
    icon: string;
    surface: string;
    text: string;
  };
}

function formatEasternTime(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function getMarketSessionView(
  market: UsEquitiesMarketState,
): MarketSessionView {
  if (!market.calendarCovered) {
    return {
      detail: "calendar update required",
      icon: AlertTriangle,
      label: "Unavailable",
      tone: {
        border: "border-red-300/30",
        icon: "text-red-200",
        surface: "bg-red-500/10",
        text: "text-red-100",
      },
    };
  }

  if (market.isOpen) {
    return {
      detail: `closes ${formatEasternTime(market.closeAt)}`,
      icon: CheckCircle2,
      label: market.sessionType === "early_close" ? "Open · early close" : "Open",
      tone: {
        border: "border-emerald-300/30",
        icon: "text-emerald-200",
        surface: "bg-emerald-400/10",
        text: "text-emerald-100",
      },
    };
  }

  if (market.phase === "pre_market") {
    return {
      detail: `opens ${formatEasternTime(market.openAt)}`,
      icon: CalendarClock,
      label: "Pre-market",
      tone: {
        border: "border-cyan-300/30",
        icon: "text-cyan-200",
        surface: "bg-cyan-400/10",
        text: "text-cyan-100",
      },
    };
  }

  if (market.isWeekendPrewarm) {
    return {
      detail:
        `next session ${formatEasternTime(market.nextSession?.openAt ?? null)}`,
      icon: RefreshCw,
      label: "Prewarm window",
      tone: {
        border: "border-cyan-300/30",
        icon: "text-cyan-200",
        surface: "bg-cyan-400/10",
        text: "text-cyan-100",
      },
    };
  }

  const nextOpen = formatEasternTime(market.nextSession?.openAt ?? null);

  return {
    detail:
      market.holidayName ??
      (market.sessionType === "early_close"
        ? `closed at ${formatEasternTime(market.closeAt)}`
        : nextOpen
          ? `next session ${nextOpen}`
          : "calendar update required"),
    icon: CalendarClock,
    label: "Closed",
    tone: {
      border: "border-white/10",
      icon: "text-zinc-400",
      surface: "bg-white/[0.04]",
      text: "text-zinc-200",
    },
  };
}

export function MarketSessionStatusPill({
  className = "",
  initialState,
}: {
  className?: string;
  initialState: UsEquitiesMarketState;
}) {
  const [market, setMarket] = useState(initialState);
  const view = getMarketSessionView(market);
  const Icon = view.icon;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setMarket(getUsEquitiesMarketState());
      interval = setInterval(() => {
        setMarket(getUsEquitiesMarketState());
      }, 60_000);
    }, 60_000 - Date.now() % 60_000);

    return () => {
      clearTimeout(timeout);

      if (interval) {
        clearInterval(interval);
      }
    };
  }, []);

  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-sm ${view.tone.border} ${view.tone.surface} ${view.tone.text} ${className}`}
      title={`${view.label} - ${view.detail}`}
    >
      <Icon className={`size-4 shrink-0 ${view.tone.icon}`} />
      <span className="truncate">
        {view.label} · {view.detail}
      </span>
    </span>
  );
}
