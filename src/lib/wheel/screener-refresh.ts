import { getEnv } from "@/lib/env";
import { getSupabaseServiceConfig } from "@/lib/supabase/rest";
import {
  getLatestMaterializedWheelScreenerSnapshot,
  materializedSnapshotAgeMs,
} from "./materialized-screener";
import type {
  PersonaId,
  WheelCompanyStrategy,
  WheelScreenerRequest,
} from "./types";
import { companyStrategySchema, personaIdSchema } from "./validation";

const RUNNING_SNAPSHOT_TIMEOUT_MS = 45 * 60 * 1000;
const DEFAULT_REFRESH_BATCH_SIZE = 8;
const DEFAULT_REFRESH_LIMIT = 50;
const easternTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export interface ScreenerRefreshDecision {
  ageMs: number | null;
  reason: string;
  request: WheelScreenerRequest;
  snapshotId: string | null;
  status: "due" | "recent" | "running" | "not_configured";
}

export interface EasternMarketHoursState {
  easternMinutes: number;
  isMarketDay: boolean;
  isOpen: boolean;
  isWeekendPrewarm: boolean;
  weekday: string;
}

function parseCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function getEasternMarketHoursState(
  date = new Date(),
): EasternMarketHoursState {
  const parts = Object.fromEntries(
    easternTimeFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekday = parts.weekday ?? "";
  const easternMinutes =
    Number.parseInt(parts.hour ?? "0", 10) * 60 +
    Number.parseInt(parts.minute ?? "0", 10);
  const isMarketDay = !["Sat", "Sun"].includes(weekday);
  const isWeekend = ["Sat", "Sun"].includes(weekday);
  const marketOpenMinutes = 9 * 60 + 30;
  const marketCloseMinutes = 16 * 60;
  const weekendPrewarmOpenMinutes = 16 * 60;
  const weekendPrewarmCloseMinutes = 18 * 60;

  return {
    easternMinutes,
    isMarketDay,
    isOpen:
      isMarketDay &&
      easternMinutes >= marketOpenMinutes &&
      easternMinutes <= marketCloseMinutes,
    isWeekendPrewarm:
      isWeekend &&
      easternMinutes >= weekendPrewarmOpenMinutes &&
      easternMinutes <= weekendPrewarmCloseMinutes,
    weekday,
  };
}

export function getScreenerRefreshMaxRuns() {
  return parsePositiveInteger(getEnv().WHEEL_SCREENER_REFRESH_MAX_RUNS, 1);
}

export function getScreenerWeekendRefreshMaxRuns() {
  return parsePositiveInteger(
    getEnv().WHEEL_SCREENER_WEEKEND_REFRESH_MAX_RUNS,
    4,
  );
}

export function getScreenerRefreshMinAgeMs() {
  return parsePositiveInteger(
    getEnv().WHEEL_SCREENER_REFRESH_MIN_AGE_MINUTES,
    45,
  ) * 60 * 1000;
}

function getRefreshRequests({
  batchSize = DEFAULT_REFRESH_BATCH_SIZE,
  limit = DEFAULT_REFRESH_LIMIT,
  personasCsv,
  strategiesCsv,
}: {
  batchSize?: number;
  limit?: number;
  personasCsv: string;
  strategiesCsv: string;
}): WheelScreenerRequest[] {
  const personas = unique(
    parseCsv(personasCsv)
      .map((persona) => personaIdSchema.safeParse(persona))
      .filter((result) => result.success)
      .map((result) => result.data),
  );
  const strategies = unique(
    parseCsv(strategiesCsv)
      .map((strategy) => companyStrategySchema.safeParse(strategy))
      .filter((result) => result.success)
      .map((result) => result.data),
  );

  return personas.flatMap((persona) =>
    strategies.map((strategy) => ({
      persona: persona as PersonaId,
      strategy: strategy as WheelCompanyStrategy,
      limit,
      batchSize,
      forceRefresh: true,
    })),
  );
}

export function getScheduledScreenerRefreshRequests(): WheelScreenerRequest[] {
  const env = getEnv();

  return getRefreshRequests({
    personasCsv: env.WHEEL_SCREENER_REFRESH_PERSONAS,
    strategiesCsv: env.WHEEL_SCREENER_REFRESH_STRATEGIES,
  });
}

export function getOptionsIndexRefreshMaxRuns() {
  return parsePositiveInteger(
    getEnv().WHEEL_OPTIONS_INDEX_REFRESH_MAX_RUNS,
    4,
  );
}

export function getOptionsIndexWeekendRefreshMaxRuns() {
  return parsePositiveInteger(
    getEnv().WHEEL_OPTIONS_INDEX_WEEKEND_REFRESH_MAX_RUNS,
    4,
  );
}

export function getOptionsIndexRefreshMinAgeMs() {
  return parsePositiveInteger(
    getEnv().WHEEL_OPTIONS_INDEX_REFRESH_MIN_AGE_MINUTES,
    15,
  ) * 60 * 1000;
}

export function getOptionsIndexRefreshRequests(): WheelScreenerRequest[] {
  const env = getEnv();

  return getRefreshRequests({
    personasCsv: env.WHEEL_OPTIONS_INDEX_REFRESH_PERSONAS,
    strategiesCsv: env.WHEEL_OPTIONS_INDEX_REFRESH_STRATEGIES,
  });
}

export async function getScreenerRefreshDecision(
  request: WheelScreenerRequest,
  minAgeMs = getScreenerRefreshMinAgeMs(),
  nowMs = Date.now(),
): Promise<ScreenerRefreshDecision> {
  if (!getSupabaseServiceConfig()) {
    return {
      ageMs: null,
      request,
      snapshotId: null,
      status: "not_configured",
      reason: "Supabase service-role configuration is missing.",
    };
  }

  const snapshot = await getLatestMaterializedWheelScreenerSnapshot(request);

  if (!snapshot) {
    return {
      ageMs: null,
      request,
      snapshotId: null,
      status: "due",
      reason: "No materialized snapshot exists.",
    };
  }

  if (snapshot.status === "running") {
    const runningAgeMs = nowMs - new Date(snapshot.started_at).getTime();

    if (runningAgeMs <= RUNNING_SNAPSHOT_TIMEOUT_MS) {
      return {
        ageMs: runningAgeMs,
        request,
        snapshotId: snapshot.id,
        status: "running",
        reason: "A matching screener snapshot is already running.",
      };
    }
  }

  if (snapshot.status === "complete") {
    const ageMs = materializedSnapshotAgeMs(snapshot, nowMs);

    if (ageMs < minAgeMs) {
      return {
        ageMs,
        request,
        snapshotId: snapshot.id,
        status: "recent",
        reason: "Latest materialized snapshot is still within refresh age.",
      };
    }
  }

  return {
    ageMs: snapshot.status === "complete"
      ? materializedSnapshotAgeMs(snapshot, nowMs)
      : null,
    request,
    snapshotId: snapshot.id,
    status: "due",
    reason: "Latest materialized snapshot is due for refresh.",
  };
}
