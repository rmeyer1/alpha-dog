import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const getDeploymentHealth = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({
  getDeploymentHealth,
}));

describe("GET /api/health/configuration", () => {
  beforeEach(() => {
    getDeploymentHealth.mockReset();
  });

  it("returns healthy live provider state without secret values", async () => {
    getDeploymentHealth.mockReturnValue({
      issues: [],
      mode: "live",
      providers: {
        alpaca: { configured: true, detail: "Configured.", required: true },
      },
      status: "ready",
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload).toEqual({
      issues: [],
      mode: "live",
      providers: {
        alpaca: { configured: true, detail: "Configured.", required: true },
      },
      status: "ready",
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
  });

  it("returns 503 when live configuration is invalid", async () => {
    getDeploymentHealth.mockReturnValue({
      issues: [{
        code: "MISSING_ALPACA_CONFIG",
        message: "Set APCA_API_KEY_ID and APCA_API_SECRET_KEY.",
        provider: "alpaca",
      }],
      mode: "live",
      providers: {
        alpaca: {
          configured: false,
          detail: "Set APCA_API_KEY_ID and APCA_API_SECRET_KEY.",
          required: true,
        },
      },
      status: "invalid",
    });

    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.status).toBe("invalid");
    expect(payload.issues[0].message).toContain("APCA_API_KEY_ID");
  });
});
