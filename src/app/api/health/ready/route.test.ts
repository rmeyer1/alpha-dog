import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const getReadinessSummary = vi.hoisted(() => vi.fn());

vi.mock("@/lib/observability/health", () => ({
  getReadinessSummary,
}));

describe("GET /api/health/ready", () => {
  beforeEach(() => {
    getReadinessSummary.mockReset();
  });

  it("returns only a safe aggregate when dependencies are healthy", async () => {
    getReadinessSummary.mockResolvedValue({
      checks: {
        optional: { healthy: 1, total: 1 },
        required: { healthy: 4, total: 4 },
      },
      durationMs: 12,
      status: "ready",
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      checks: {
        optional: { healthy: 1, total: 1 },
        required: { healthy: 4, total: 4 },
      },
      durationMs: 12,
      status: "ready",
    });
    expect(JSON.stringify(payload)).not.toMatch(
      /alpaca|openai|supabase|finnhub|polymarket|secret|token|url/i,
    );
  });

  it("returns 503 while liveness remains independent", async () => {
    getReadinessSummary.mockResolvedValue({
      checks: {
        optional: { healthy: 0, total: 1 },
        required: { healthy: 3, total: 4 },
      },
      durationMs: 1_500,
      status: "not_ready",
    });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
    });
  });
});
