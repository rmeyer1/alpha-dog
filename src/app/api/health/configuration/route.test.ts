import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const getConfigurationSummary = vi.hoisted(() => vi.fn());

vi.mock("@/lib/observability/health", () => ({
  getConfigurationSummary,
}));

describe("GET /api/health/configuration", () => {
  beforeEach(() => {
    getConfigurationSummary.mockReset();
  });

  it("returns healthy live provider state without secret values", async () => {
    getConfigurationSummary.mockReturnValue({
      checks: {
        optional: { configured: 1, total: 1 },
        required: { configured: 4, total: 4 },
      },
      mode: "live",
      status: "ready",
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      checks: {
        optional: { configured: 1, total: 1 },
        required: { configured: 4, total: 4 },
      },
      mode: "live",
      status: "ready",
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("returns 503 when live configuration is invalid", async () => {
    getConfigurationSummary.mockReturnValue({
      checks: {
        optional: { configured: 0, total: 1 },
        required: { configured: 0, total: 4 },
      },
      mode: "live",
      status: "invalid",
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.status).toBe("invalid");
    expect(JSON.stringify(payload)).not.toContain("APCA_API_KEY_ID");
  });
});
