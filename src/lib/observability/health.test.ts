import { describe, expect, it, vi } from "vitest";
import { parseAppEnv } from "@/lib/env";
import { providerMalformedResponse } from "./provider";
import {
  getReadinessSummary,
  getConfigurationSummary,
  refreshSharedReadinessSummary,
  refreshReadiness,
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

  it("serves only the shared aggregate without running provider probes", async () => {
    const summary: ReadinessSummary = {
      checks: {
        optional: { healthy: 0, total: 0 },
        required: { healthy: 1, total: 1 },
      },
      durationMs: 12,
      status: "ready",
    };
    const maybeSingle = vi.fn(async () => ({
      data: {
        expires_at: new Date(Date.now() + 30_000).toISOString(),
        summary,
      },
      error: null,
    }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle })),
        })),
      })),
    };

    await expect(getReadinessSummary(client as never)).resolves.toEqual(
      summary,
    );
    expect(client.from).toHaveBeenCalledWith(
      "observability_readiness_state",
    );
  });

  it("uses the database lease to prevent distributed refresh fan-out", async () => {
    const summary: ReadinessSummary = {
      checks: {
        optional: { healthy: 0, total: 0 },
        required: { healthy: 1, total: 1 },
      },
      durationMs: 12,
      status: "ready",
    };
    const refresh = vi.fn(async () => summary);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(refreshSharedReadinessSummary({
      client: { rpc } as never,
      refresh,
    })).resolves.toEqual(summary);

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_observability_readiness_refresh",
      "complete_observability_readiness_refresh",
    ]);
    expect(refresh).toHaveBeenCalledOnce();
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

  it("executes all configured read-only provider probes through real boundaries", async () => {
    const env = parseAppEnv({
      ALPHA_DOG_DEPLOYMENT_MODE: "live",
      ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
      ALPHA_DOG_SUPABASE_URL: "https://alpha.supabase.co",
      APCA_API_KEY_ID: "alpaca-key",
      APCA_API_SECRET_KEY: "alpaca-secret",
      EARNINGS_PROVIDER_ENABLED: "true",
      FINNHUB_API_KEY: "finnhub-key",
      NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY: "anon-key",
      NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL: "https://alpha.supabase.co",
      OPENAI_API_KEY: "openai-key",
    });
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));

      if (url.pathname === "/v2/clock") {
        return Response.json({ timestamp: "2026-07-24T12:00:00Z" });
      }
      if (url.pathname.startsWith("/v1/models/")) {
        return Response.json({ id: "gpt-5.4-mini" });
      }
      if (url.pathname === "/api/v1/stock/profile2") {
        return Response.json({});
      }
      if (url.pathname === "/rest/v1/paper_accounts") {
        return Response.json([]);
      }
      if (url.pathname === "/auth/v1/health") {
        return Response.json({ name: "GoTrue" });
      }

      return new Response(null, { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const summary = await refreshReadiness(env);

    expect(summary).toMatchObject({
      checks: {
        optional: { healthy: 1, total: 1 },
        required: { healthy: 5, total: 5 },
      },
      status: "ready",
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        cache: "no-store",
        opentelemetry: {
          ignore: true,
          propagateContext: false,
        },
      });
      expect(init?.method ?? "GET").toMatch(/^(GET|HEAD)$/);
    }
    expect(getConfigurationSummary(env)).toMatchObject({
      checks: {
        optional: { configured: 0, total: 0 },
        required: { configured: 5, total: 5 },
      },
      mode: "live",
      status: "ready",
    });

    vi.unstubAllGlobals();
  });

  it("fails a configured dependency with malformed output without leaking it", async () => {
    const env = parseAppEnv({
      ALPHA_DOG_DEPLOYMENT_MODE: "live",
      OPENAI_API_KEY: "openai-key",
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("provider body secret", { status: 200 })),
    );

    const summary = await refreshReadiness(env);

    expect(summary.status).toBe("not_ready");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "provider body secret",
    );

    vi.unstubAllGlobals();
    warn.mockRestore();
  });
});
