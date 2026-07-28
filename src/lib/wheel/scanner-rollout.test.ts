import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emitTelemetry: vi.fn(),
  legacy: vi.fn(),
  replacement: vi.fn(),
  rest: vi.fn(),
}));

vi.mock("@/lib/observability/telemetry", () => ({
  emitTelemetry: mocks.emitTelemetry,
}));
vi.mock("@/lib/supabase/rest", () => ({
  requestSupabaseRest: mocks.rest,
}));
vi.mock("./materialized-screener", () => ({
  getMaterializedWheelScreenerResponse: mocks.legacy,
}));
vi.mock("./market-batch/reader", () => ({
  getSharedMarketBatchScreenerResponse: mocks.replacement,
}));

const request = {
  persona: "balanced_wheel" as const,
  strategy: "short_put" as const,
};
const legacyResponse = { companies: [{ ticker: "LEGACY" }] };
const replacementResponse = { companies: [{ ticker: "REPLACEMENT" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rest.mockResolvedValue([{
    observation_started_on: null,
    read_source: "legacy",
    updated_at: "2026-07-28T00:00:00.000Z",
  }]);
  mocks.legacy.mockResolvedValue(legacyResponse);
  mocks.replacement.mockResolvedValue(replacementResponse);
});

describe("wheel scanner rollout reader", () => {
  it("defaults to the legacy reader and does not touch replacement storage", async () => {
    const { getControlledWheelScreenerRead } = await import("./scanner-rollout");

    await expect(getControlledWheelScreenerRead(request)).resolves.toEqual({
      fallback: false,
      requestedSource: "legacy",
      response: legacyResponse,
      source: "legacy",
    });
    expect(mocks.replacement).not.toHaveBeenCalled();
  });

  it("selects a complete replacement response", async () => {
    mocks.rest.mockResolvedValue([{
      observation_started_on: "2026-07-28",
      read_source: "replacement",
      updated_at: "2026-07-28T00:00:00.000Z",
    }]);
    const { getControlledWheelScreenerRead } = await import("./scanner-rollout");

    await expect(getControlledWheelScreenerRead(request)).resolves.toEqual({
      fallback: false,
      requestedSource: "replacement",
      response: replacementResponse,
      source: "replacement",
    });
    expect(mocks.legacy).not.toHaveBeenCalled();
  });

  it("falls back immediately when replacement has no complete pointer", async () => {
    mocks.rest.mockResolvedValue([{ read_source: "replacement" }]);
    mocks.replacement.mockResolvedValue(null);
    const { getControlledWheelScreenerRead } = await import("./scanner-rollout");

    await expect(getControlledWheelScreenerRead(request)).resolves.toEqual({
      fallback: true,
      requestedSource: "replacement",
      response: legacyResponse,
      source: "legacy",
    });
    expect(mocks.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "legacy_fallback" }),
    );
  });

  it("reports unavailable when neither complete source exists", async () => {
    mocks.rest.mockResolvedValue([{ read_source: "replacement" }]);
    mocks.replacement.mockResolvedValue(null);
    mocks.legacy.mockResolvedValue(null);
    const { getControlledWheelScreenerRead } = await import("./scanner-rollout");

    await expect(getControlledWheelScreenerRead(request)).resolves.toEqual({
      fallback: false,
      requestedSource: "replacement",
      response: null,
      source: null,
    });
    expect(mocks.emitTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "unavailable",
        severity: "error",
      }),
    );
  });

  it("fails safe to legacy if the control plane is unavailable", async () => {
    mocks.rest.mockRejectedValue(new Error("control unavailable"));
    const { getControlledWheelScreenerRead } = await import("./scanner-rollout");

    await expect(getControlledWheelScreenerRead(request)).resolves.toEqual(
      expect.objectContaining({
        requestedSource: "legacy",
        response: legacyResponse,
      }),
    );
  });

  it("treats a missing control row as legacy", async () => {
    mocks.rest.mockResolvedValue([]);
    const { getControlledWheelScreenerRead } = await import("./scanner-rollout");

    await expect(getControlledWheelScreenerRead(request)).resolves.toEqual(
      expect.objectContaining({ requestedSource: "legacy" }),
    );
  });
});
