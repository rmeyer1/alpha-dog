import type {
  DataFeed,
  PersonaId,
  WheelCompanyStrategy,
  WheelAnalysisResponse,
  WheelFilters,
} from "./types";
import {
  getRuntimeCacheValue,
  setRuntimeCacheValue,
} from "./vercel-runtime-cache";

export const ANALYSIS_CACHE_VERSION = "v2";
export const ANALYSIS_CACHE_FRESH_TTL_MS = 2 * 60 * 1000;
export const ANALYSIS_CACHE_STALE_TTL_MS = 30 * 60 * 1000;

export interface AnalysisCacheEntry {
  response: WheelAnalysisResponse;
  writtenAtMs: number;
  freshUntilMs: number;
  staleUntilMs: number;
}

interface AnalysisCacheKeyInput {
  feed: Exclude<DataFeed, "demo">;
  filters: WheelFilters;
  personaId: PersonaId;
  resultLimit: number;
  strategy?: WheelCompanyStrategy;
  ticker: string;
}

export interface AnalysisCacheStore {
  clear(): void;
  getFresh(key: string, nowMs?: number): AnalysisCacheEntry | null;
  getStale(key: string, nowMs?: number): AnalysisCacheEntry | null;
  set(key: string, response: WheelAnalysisResponse, nowMs?: number): void;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries
    .map(([key, entryValue]) =>
      `${JSON.stringify(key)}:${stableStringify(entryValue)}`,
    )
    .join(",")}}`;
}

function cloneResponse(response: WheelAnalysisResponse): WheelAnalysisResponse {
  return structuredClone(response);
}

function cloneEntry(entry: AnalysisCacheEntry): AnalysisCacheEntry {
  return {
    ...entry,
    response: cloneResponse(entry.response),
  };
}

export function buildAnalysisCacheKey(input: AnalysisCacheKeyInput) {
  return [
    "wheel-analysis",
    ANALYSIS_CACHE_VERSION,
    input.feed,
    input.ticker.trim().toUpperCase(),
    input.personaId,
    input.strategy ?? "all",
    String(input.resultLimit),
    stableStringify(input.filters),
  ].join(":");
}

export class MemoryAnalysisCacheStore implements AnalysisCacheStore {
  private readonly entries = new Map<string, AnalysisCacheEntry>();

  clear() {
    this.entries.clear();
  }

  getFresh(key: string, nowMs = Date.now()) {
    const entry = this.entries.get(key);

    if (!entry) {
      return null;
    }

    if (nowMs <= entry.freshUntilMs) {
      return cloneEntry(entry);
    }

    return null;
  }

  getStale(key: string, nowMs = Date.now()) {
    const entry = this.entries.get(key);

    if (!entry) {
      return null;
    }

    if (nowMs <= entry.staleUntilMs) {
      return cloneEntry(entry);
    }

    this.entries.delete(key);

    return null;
  }

  set(key: string, response: WheelAnalysisResponse, nowMs = Date.now()) {
    this.entries.set(key, {
      response: cloneResponse(response),
      writtenAtMs: nowMs,
      freshUntilMs: nowMs + ANALYSIS_CACHE_FRESH_TTL_MS,
      staleUntilMs: nowMs + ANALYSIS_CACHE_STALE_TTL_MS,
    });
  }
}

let memoryStore: MemoryAnalysisCacheStore | null = null;

export function getAnalysisCacheStore(): AnalysisCacheStore {
  if (!memoryStore) {
    memoryStore = new MemoryAnalysisCacheStore();
  }

  return memoryStore;
}

export function clearAnalysisCacheForTests() {
  memoryStore?.clear();
}

export function cachedEntryNextRefresh(entry: AnalysisCacheEntry) {
  return new Date(entry.freshUntilMs).toISOString();
}

export async function getFreshRuntimeAnalysisCache(
  key: string,
  nowMs = Date.now(),
) {
  const entry = await getRuntimeCacheValue<AnalysisCacheEntry>(key);

  if (!entry || nowMs > entry.freshUntilMs) {
    return null;
  }

  return cloneEntry(entry);
}

export async function getStaleRuntimeAnalysisCache(
  key: string,
  nowMs = Date.now(),
) {
  const entry = await getRuntimeCacheValue<AnalysisCacheEntry>(key);

  if (!entry || nowMs > entry.staleUntilMs) {
    return null;
  }

  return cloneEntry(entry);
}

export async function setRuntimeAnalysisCache(
  key: string,
  response: WheelAnalysisResponse,
  nowMs = Date.now(),
) {
  await setRuntimeCacheValue(
    key,
    {
      response: cloneResponse(response),
      writtenAtMs: nowMs,
      freshUntilMs: nowMs + ANALYSIS_CACHE_FRESH_TTL_MS,
      staleUntilMs: nowMs + ANALYSIS_CACHE_STALE_TTL_MS,
    } satisfies AnalysisCacheEntry,
    {
      name: "wheel-analysis",
      tags: ["wheel-analysis"],
      ttlSeconds: Math.ceil(ANALYSIS_CACHE_STALE_TTL_MS / 1000),
    },
  );
}
