import { describe, expect, it, vi } from "vitest";
import {
  emitTelemetry,
  serializeTelemetryEvent,
} from "./telemetry";

const CANARIES = [
  "nested-secret-canary",
  "authorization-bearer-canary",
  "cookie-canary",
  "service-role-key-canary",
  "person@example.test",
  "0xwallet-canary",
  "statement-row-canary",
  "prompt-canary",
  "provider-body-canary",
  "https://internal.example.test/path?token=url-canary",
];

describe("structured telemetry serialization", () => {
  it("allowlists final serialized fields and drops nested sensitive canaries", () => {
    const caused = new Error(CANARIES[1]);
    const error = new Error(CANARIES[0], { cause: caused });

    Object.assign(error, {
      name: CANARIES[2],
      stack: CANARIES[3],
    });

    const serialized = serializeTelemetryEvent({
      event: "provider.request",
      operation: "company_profile",
      outcome: "network_error",
      provider: "finnhub",
      error,
      headers: { authorization: CANARIES[1], cookie: CANARIES[2] },
      nested: { secret: CANARIES[0] },
      query: CANARIES[9],
      email: CANARIES[4],
      wallet: CANARIES[5],
      rows: [{ value: CANARIES[6] }],
      prompt: CANARIES[7],
      rawProviderBody: CANARIES[8],
      url: CANARIES[9],
    } as never);

    for (const canary of CANARIES) {
      expect(serialized).not.toContain(canary);
    }
    expect(JSON.parse(serialized)).toMatchObject({
      errorClass: "UnknownError",
      event: "provider.request",
      operation: "company_profile",
      outcome: "network_error",
      provider: "finnhub",
      telemetryVersion: 1,
    });
  });

  it("bounds durations, ages, attempts, and unsafe dimensions", () => {
    const record = JSON.parse(serializeTelemetryEvent({
      ageMs: Number.POSITIVE_INFINITY,
      attempt: 1_000_000,
      durationMs: -42,
      event: "bad event with spaces",
      operation: "unsafe/operation?symbol=SECRET",
      outcome: "success",
      provider: "unknown/provider",
    }));

    expect(record).toMatchObject({
      attempt: 100,
      durationMs: 0,
      event: "telemetry.invalid_event",
      operation: "unknown",
      provider: "unknown",
    });
    expect(record).not.toHaveProperty("ageMs");
  });

  it("contains serialization failures without changing application behavior", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stringify = vi.spyOn(JSON, "stringify")
      .mockImplementationOnce(() => {
        throw new Error("serialization canary");
      });

    expect(() =>
      emitTelemetry({ event: "api.request", outcome: "success" })
    ).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("telemetry.serialization_failed"),
    );

    stringify.mockRestore();
    error.mockRestore();
  });
});
