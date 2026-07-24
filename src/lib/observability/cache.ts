import { emitTelemetry } from "./telemetry";

export type CacheTelemetryState =
  | "bypass"
  | "fresh_hit"
  | "miss"
  | "stale_fallback"
  | "write_failure"
  | "write_success";

export function emitCacheTelemetry(
  operation: string,
  cacheState: CacheTelemetryState,
  options: { ageMs?: number; error?: unknown } = {},
) {
  emitTelemetry({
    ageMs: options.ageMs,
    cacheState,
    error: options.error,
    errorCode:
      cacheState === "write_failure" ? "CACHE_WRITE_FAILED" : undefined,
    event: "cache.operation",
    operation,
    outcome:
      cacheState === "write_failure"
        ? "failure"
        : cacheState === "miss"
          ? "miss"
          : "success",
    severity: cacheState === "write_failure" ? "warn" : "info",
  });
}
