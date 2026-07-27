import { performance } from "node:perf_hooks";
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { refreshSupabaseSession } from "@/lib/supabase/session-middleware";
import { proxy } from "./proxy";

const BATCHES = 80;
const REQUESTS_PER_BATCH = 100;
const P95_OVERHEAD_LIMIT_MS = 1;

function percentile(samples: number[], value: number) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil((value / 100) * sorted.length) - 1,
  );

  return sorted[index] ?? 0;
}

async function measureBatch(operation: () => Promise<void>) {
  const startedAt = performance.now();

  for (let index = 0; index < REQUESTS_PER_BATCH; index += 1) {
    await operation();
  }

  return (performance.now() - startedAt) / REQUESTS_PER_BATCH;
}

describe("document security proxy benchmark", () => {
  it("adds less than one millisecond at p95 for nonce and CSP assembly", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://alpha-dog.test/screeners");
    const baseline = () => refreshSupabaseSession(request);
    const secured = () => proxy(request);

    await measureBatch(baseline);
    await measureBatch(secured);

    const baselineSamples: number[] = [];
    const securedSamples: number[] = [];

    for (let batch = 0; batch < BATCHES; batch += 1) {
      if (batch % 2 === 0) {
        baselineSamples.push(await measureBatch(baseline));
        securedSamples.push(await measureBatch(secured));
      } else {
        securedSamples.push(await measureBatch(secured));
        baselineSamples.push(await measureBatch(baseline));
      }
    }

    const measurements = {
      baseline: {
        medianMs: percentile(baselineSamples, 50),
        p95Ms: percentile(baselineSamples, 95),
      },
      overheadLimitMs: P95_OVERHEAD_LIMIT_MS,
      requests: BATCHES * REQUESTS_PER_BATCH,
      secured: {
        medianMs: percentile(securedSamples, 50),
        p95Ms: percentile(securedSamples, 95),
      },
    };

    console.info("document_security_proxy_benchmark", measurements);

    expect(measurements.secured.p95Ms)
      .toBeLessThanOrEqual(
        measurements.baseline.p95Ms + P95_OVERHEAD_LIMIT_MS,
      );
  });
});
