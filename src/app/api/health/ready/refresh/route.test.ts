import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshSharedReadinessSummary = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  getEnv: () => ({ CRON_SECRET: "cron-secret" }),
}));
vi.mock("@/lib/observability/health", () => ({
  refreshSharedReadinessSummary,
}));

import { GET } from "./route";

describe("GET /api/health/ready/refresh", () => {
  beforeEach(() => {
    refreshSharedReadinessSummary.mockReset();
  });

  it("rejects public requests before any active provider probes", async () => {
    const response = await GET(new Request(
      "https://alpha-dog.test/api/health/ready/refresh",
    ));

    expect(response.status).toBe(401);
    expect(refreshSharedReadinessSummary).not.toHaveBeenCalled();
  });

  it("refreshes the shared aggregate for the authenticated cron", async () => {
    refreshSharedReadinessSummary.mockResolvedValue({
      checks: {
        optional: { healthy: 1, total: 1 },
        required: { healthy: 4, total: 4 },
      },
      durationMs: 14,
      status: "ready",
    });

    const response = await GET(new Request(
      "https://alpha-dog.test/api/health/ready/refresh",
      { headers: { authorization: "Bearer cron-secret" } },
    ));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(refreshSharedReadinessSummary).toHaveBeenCalledOnce();
  });
});
