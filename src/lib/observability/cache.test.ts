import { describe, expect, it, vi } from "vitest";
import {
  emitCacheTelemetry,
  type CacheTelemetryState,
} from "./cache";

describe("cache telemetry", () => {
  it("serializes every required low-cardinality cache state", () => {
    const states: CacheTelemetryState[] = [
      "fresh_hit",
      "stale_fallback",
      "miss",
      "bypass",
      "write_success",
      "write_failure",
    ];
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    for (const state of states) {
      emitCacheTelemetry("wheel_analysis", state, {
        ageMs: state === "fresh_hit" ? 250 : undefined,
        error:
          state === "write_failure"
            ? new Error("cache payload canary")
            : undefined,
      });
    }

    const serialized = [...info.mock.calls, ...warn.mock.calls]
      .map(([value]) => String(value))
      .join("\n");

    for (const state of states) {
      expect(serialized).toContain(`"cacheState":"${state}"`);
    }
    expect(serialized).not.toContain("cache payload canary");

    info.mockRestore();
    warn.mockRestore();
  });
});
