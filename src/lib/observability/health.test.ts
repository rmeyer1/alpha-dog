import { describe, expect, it, vi } from "vitest";
import { providerMalformedResponse } from "./provider";
import {
  getReadinessSummary,
  resetReadinessCacheForTests,
  runReadinessProbes,
  type DependencyProbe,
  type ReadinessSummary,
} from "./health";

function probe(
  name: string,
  required: boolean,
  run: DependencyProbe["run"],
): DependencyProbe {
  return { name, provider: "supabase", required, run };
}

describe("readiness probes", () => {
  it("runs dependency probes concurrently", async () => {
    let started = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const probes = [1, 2, 3].map((index) =>
      probe(`probe_${index}`, true, async () => {
        started += 1;
        await gate;
      })
    );
    const pending = runReadinessProbes(probes);

    await Promise.resolve();
    expect(started).toBe(3);
    release?.();
    await expect(pending).resolves.toMatchObject({
      checks: {
        required: { healthy: 3, total: 3 },
      },
      status: "ready",
    });
  });

  it("fails readiness for required timeout or malformed response", async () => {
    const summary = await runReadinessProbes([
      probe("timeout", true, async () => {
        throw new DOMException("timeout secret", "TimeoutError");
      }),
      probe("malformed", true, async () => {
        throw providerMalformedResponse("raw body secret");
      }),
    ]);

    expect(summary).toMatchObject({
      checks: {
        required: { healthy: 0, total: 2 },
      },
      status: "not_ready",
    });
  });

  it("reports optional degradation without failing readiness", async () => {
    const summary = await runReadinessProbes([
      probe("required", true, async () => {}),
      probe("optional", false, async () => {
        throw new Error("optional down");
      }),
    ]);

    expect(summary).toMatchObject({
      checks: {
        optional: { healthy: 0, total: 1 },
        required: { healthy: 1, total: 1 },
      },
      status: "ready",
    });
  });

  it("fails readiness when configuration is invalid", async () => {
    await expect(runReadinessProbes([], false)).resolves.toMatchObject({
      status: "not_ready",
    });
  });

  it("coalesces concurrent public checks and serves the bounded cache", async () => {
    resetReadinessCacheForTests();
    const summary: ReadinessSummary = {
      checks: {
        optional: { healthy: 0, total: 0 },
        required: { healthy: 1, total: 1 },
      },
      durationMs: 12,
      status: "ready",
    };
    const refresh = vi.fn(async () => summary);

    const results = await Promise.all(
      Array.from({ length: 25 }, () => getReadinessSummary(refresh)),
    );
    const cached = await getReadinessSummary(refresh);

    expect(refresh).toHaveBeenCalledOnce();
    expect(results.every((value) => value === summary)).toBe(true);
    expect(cached).toBe(summary);
  });

  it("times out probes concurrently near the slowest timeout", async () => {
    const timeoutMs = 25;
    const probes = [1, 2, 3].map((index) =>
      probe(`timeout_${index}`, true, async (signal) => {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      })
    );
    const startedAt = performance.now();
    const summary = await runReadinessProbes(probes, true, timeoutMs);
    const elapsedMs = performance.now() - startedAt;

    expect(summary.status).toBe("not_ready");
    expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs - 5);
    expect(elapsedMs).toBeLessThan(timeoutMs * 2.5);
  });
});
