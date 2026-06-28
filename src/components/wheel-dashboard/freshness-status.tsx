import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  RefreshCw,
} from "lucide-react";
import type { ComponentType } from "react";
import type {
  WheelAnalysisResponse,
  WheelRefreshStatus,
} from "@/lib/wheel/types";
import type { RequestState } from "./types";

type DataFreshness = WheelAnalysisResponse["dataFreshness"];

type FreshnessDisplayStatus = WheelRefreshStatus | "pending" | "loading";

export interface FreshnessView {
  detail: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  status: FreshnessDisplayStatus;
  title: string;
  tone: {
    border: string;
    icon: string;
    surface: string;
    text: string;
  };
}

function formatTime(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function completedTime(freshness: DataFreshness) {
  return formatTime(freshness.lastCompletedAt) ?? formatTime(freshness.asOf);
}

function ageLabel(ageMinutes: number | undefined) {
  if (ageMinutes == null) {
    return null;
  }

  if (ageMinutes < 1) {
    return "less than 1m old";
  }

  return `${Math.round(ageMinutes)}m old`;
}

export function getFreshnessView(
  freshness: DataFreshness | null | undefined,
  fallbackStatus: RequestState,
): FreshnessView {
  if (!freshness) {
    if (fallbackStatus === "loading" || fallbackStatus === "refreshing") {
      return {
        detail: "loading results",
        icon: RefreshCw,
        label: "Loading",
        status: "loading",
        title: "Loading results",
        tone: {
          border: "border-cyan-300/30",
          icon: "text-cyan-200",
          surface: "bg-cyan-400/10",
          text: "text-cyan-100",
        },
      };
    }

    if (fallbackStatus === "errorNoCache") {
      return {
        detail: "no cached results",
        icon: AlertTriangle,
        label: "No data",
        status: "failed",
        title: "No cached data",
        tone: {
          border: "border-red-300/30",
          icon: "text-red-200",
          surface: "bg-red-500/10",
          text: "text-red-100",
        },
      };
    }

    return {
      detail: "waiting for results",
      icon: Clock3,
      label: "Pending",
      status: "pending",
      title: "Pending",
      tone: {
        border: "border-white/10",
        icon: "text-zinc-400",
        surface: "bg-white/[0.04]",
        text: "text-zinc-200",
      },
    };
  }

  const status = freshness.refreshStatus ?? freshness.cacheStatus;
  const lastCompleted = completedTime(freshness);
  const lastStarted = formatTime(freshness.lastStartedAt);
  const age = ageLabel(freshness.ageMinutes);

  switch (status) {
    case "demo":
      return {
        detail: "sample results",
        icon: Database,
        label: "Demo data",
        status,
        title: "Demo data",
        tone: {
          border: "border-violet-300/30",
          icon: "text-violet-200",
          surface: "bg-violet-400/10",
          text: "text-violet-100",
        },
      };
    case "failed":
      return {
        detail: lastCompleted
          ? `showing last completed results from ${lastCompleted}`
          : "showing last completed results",
        icon: AlertTriangle,
        label: "Refresh failed",
        status,
        title: "Refresh failed",
        tone: {
          border: "border-amber-300/35",
          icon: "text-amber-200",
          surface: "bg-amber-400/10",
          text: "text-amber-100",
        },
      };
    case "refreshing":
      return {
        detail: lastStarted
          ? `showing cached results; started ${lastStarted}`
          : "showing latest cached results",
        icon: RefreshCw,
        label: "Refreshing",
        status,
        title: "Refreshing",
        tone: {
          border: "border-cyan-300/30",
          icon: "text-cyan-200",
          surface: "bg-cyan-400/10",
          text: "text-cyan-100",
        },
      };
    case "stale":
      return {
        detail: lastCompleted
          ? `last completed ${lastCompleted}`
          : age ?? "cached results",
        icon: Clock3,
        label: "Stale",
        status,
        title: "Stale",
        tone: {
          border: "border-amber-300/30",
          icon: "text-amber-200",
          surface: "bg-amber-400/10",
          text: "text-amber-100",
        },
      };
    case "fresh":
      return {
        detail: lastCompleted
          ? `updated ${lastCompleted}`
          : age ?? "updated recently",
        icon: CheckCircle2,
        label: "Fresh",
        status,
        title: "Fresh",
        tone: {
          border: "border-emerald-300/30",
          icon: "text-emerald-200",
          surface: "bg-emerald-400/10",
          text: "text-emerald-100",
        },
      };
  }
}

export function FreshnessStatusPill({
  className = "",
  view,
}: {
  className?: string;
  view: FreshnessView;
}) {
  const Icon = view.icon;

  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-md border px-2 py-1 text-sm ${view.tone.border} ${view.tone.surface} ${view.tone.text} ${className}`}
      title={`${view.title} - ${view.detail}`}
    >
      <Icon
        className={`size-4 shrink-0 ${view.tone.icon} ${
          view.status === "refreshing" || view.status === "loading"
            ? "animate-spin"
            : ""
        }`}
      />
      <span className="truncate">
        {view.title} · {view.detail}
      </span>
    </span>
  );
}
