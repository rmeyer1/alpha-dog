import { performance } from "node:perf_hooks";
import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupabaseRouteClient: vi.fn(),
  getSupabaseAuthConfig: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("./auth", () => ({
  getSupabaseAuthConfig: mocks.getSupabaseAuthConfig,
}));

vi.mock("./server", () => ({
  createSupabaseRouteClient: mocks.createSupabaseRouteClient,
}));

import { refreshSupabaseSession } from "./session-middleware";

const PUBLIC_REQUESTS = [
  new NextRequest("https://alpha-dog.test/"),
  new NextRequest("https://alpha-dog.test/screeners"),
  new NextRequest("https://alpha-dog.test/traders"),
  new NextRequest("https://alpha-dog.test/api/logos/AAPL"),
];
const BATCHES = 80;
const REQUESTS_PER_ROUTE_PER_BATCH = 25;
const LOCAL_NOISE_TOLERANCE_MS = 0.05;

function percentile(samples: number[], value: number) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((value / 100) * sorted.length) - 1,
  );

  return sorted[index] ?? 0;
}

async function measureBatch(operation: (request: NextRequest) => Promise<void>) {
  const startedAt = performance.now();

  for (const request of PUBLIC_REQUESTS) {
    for (let index = 0; index < REQUESTS_PER_ROUTE_PER_BATCH; index += 1) {
      await operation(request);
    }
  }

  return (performance.now() - startedAt) /
    (PUBLIC_REQUESTS.length * REQUESTS_PER_ROUTE_PER_BATCH);
}

describe("session proxy public-request benchmark", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseAuthConfig.mockReturnValue({
      anonKey: "test-publishable-key",
      url: "https://project-ref.supabase.co",
    });
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
    mocks.createSupabaseRouteClient.mockReturnValue({
      auth: { getUser: mocks.getUser },
    });
  });

  it("eliminates public Auth calls without a material local median or p95 regression", async () => {
    let legacyAuthCalls = 0;

    const legacyPublicRefresh = async (request: NextRequest) => {
      const response = NextResponse.next({ request });
      const supabase = mocks.createSupabaseRouteClient(request, response);

      if (supabase) {
        legacyAuthCalls += 1;
        await supabase.auth.getUser();
      }
    };
    const scopedPublicRefresh = async (request: NextRequest) => {
      await refreshSupabaseSession(request);
    };

    await measureBatch(legacyPublicRefresh);
    await measureBatch(scopedPublicRefresh);
    legacyAuthCalls = 0;
    mocks.getUser.mockClear();
    mocks.createSupabaseRouteClient.mockClear();

    const legacySamples: number[] = [];
    const scopedSamples: number[] = [];

    for (let batch = 0; batch < BATCHES; batch += 1) {
      if (batch % 2 === 0) {
        legacySamples.push(await measureBatch(legacyPublicRefresh));
        scopedSamples.push(await measureBatch(scopedPublicRefresh));
      } else {
        scopedSamples.push(await measureBatch(scopedPublicRefresh));
        legacySamples.push(await measureBatch(legacyPublicRefresh));
      }
    }

    const measurements = {
      legacy: {
        authCalls: legacyAuthCalls,
        medianMs: percentile(legacySamples, 50),
        p95Ms: percentile(legacySamples, 95),
      },
      requests: BATCHES * PUBLIC_REQUESTS.length *
        REQUESTS_PER_ROUTE_PER_BATCH,
      scoped: {
        authCalls: mocks.createSupabaseRouteClient.mock.calls.length -
          legacyAuthCalls,
        medianMs: percentile(scopedSamples, 50),
        p95Ms: percentile(scopedSamples, 95),
      },
      toleranceMs: LOCAL_NOISE_TOLERANCE_MS,
    };

    console.info("session_proxy_public_benchmark", measurements);

    expect(measurements.legacy.authCalls).toBe(measurements.requests);
    expect(measurements.scoped.authCalls).toBe(0);
    expect(measurements.scoped.medianMs)
      .toBeLessThanOrEqual(
        measurements.legacy.medianMs + LOCAL_NOISE_TOLERANCE_MS,
      );
    expect(measurements.scoped.p95Ms)
      .toBeLessThanOrEqual(
        measurements.legacy.p95Ms + LOCAL_NOISE_TOLERANCE_MS,
      );
  });
});
