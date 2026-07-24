import { describe, expect, it, vi } from "vitest";
import { CORRELATION_HEADER } from "./context";
import { instrumentApiRoute } from "./route";

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * fraction),
  );

  return sorted[index] ?? 0;
}

describe("API route telemetry overhead", () => {
  it("keeps body bytes identical and adds less than one millisecond at p95", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const raw = async () => new Response('{"ok":true}', {
      headers: { "content-type": "application/json" },
    });
    const observed = instrumentApiRoute(
      { method: "GET", route: "/api/benchmark" },
      raw,
    );
    const request = new Request("https://alpha-dog.test/api/benchmark");
    const rawDurations: number[] = [];
    const observedDurations: number[] = [];

    for (let index = 0; index < 2_000; index += 1) {
      let startedAt = performance.now();
      await raw();
      rawDurations.push(performance.now() - startedAt);

      startedAt = performance.now();
      await observed(request);
      observedDurations.push(performance.now() - startedAt);
    }

    const rawResponse = await raw();
    const observedResponse = await observed(request);
    const rawBody = await rawResponse.text();
    const observedBody = await observedResponse.text();
    const rawP95 = percentile(rawDurations, 0.95);
    const observedP95 = percentile(observedDurations, 0.95);
    const result = {
      addedP95Ms: observedP95 - rawP95,
      iterations: rawDurations.length,
      observedMedianMs: percentile(observedDurations, 0.5),
      observedP95Ms: observedP95,
      rawMedianMs: percentile(rawDurations, 0.5),
      rawP95Ms: rawP95,
    };

    expect(observedBody).toBe(rawBody);
    expect(observedResponse.headers.get(CORRELATION_HEADER)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
    expect(observedP95).toBeLessThanOrEqual(rawP95 + 1);

    if (process.env.OBSERVABILITY_BENCHMARK_REPORT === "1") {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }

    info.mockRestore();
  });
});
