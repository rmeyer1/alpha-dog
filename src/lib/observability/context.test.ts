import { describe, expect, it } from "vitest";
import {
  clientCorrelationIdFromRequest,
  CORRELATION_HEADER,
  correlationIdFromRequest,
  createDurableTelemetryContext,
  normalizeCorrelationId,
  normalizeDurableTelemetryContext,
} from "./context";
import { requireDurableTelemetryContext } from "./durable-context";

describe("observability correlation context", () => {
  it("accepts only bounded ASCII correlation identifiers", () => {
    expect(normalizeCorrelationId("request-123:_ok")).toBe(
      "request-123:_ok",
    );

    for (const value of [
      "",
      " request",
      "request ",
      "request\ninjection",
      "request\u0000control",
      "rеquest-confusable",
      "x".repeat(65),
    ]) {
      expect(normalizeCorrelationId(value)).toBeNull();
    }
  });

  it("generates a unique server ID and only retains safe caller IDs", () => {
    const safeRequest = new Request("https://alpha-dog.test/api/test", {
      headers: { [CORRELATION_HEADER]: "browser-request-123" },
    });
    const unsafe = "secret@example.test Bearer-token-canary";
    const request = new Request("https://alpha-dog.test/api/test", {
      headers: { [CORRELATION_HEADER]: unsafe },
    });
    const first = correlationIdFromRequest(safeRequest);
    const second = correlationIdFromRequest(safeRequest);

    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(second).not.toBe(first);
    expect(clientCorrelationIdFromRequest(safeRequest)).toBe(
      "browser-request-123",
    );
    expect(clientCorrelationIdFromRequest(request)).toBeNull();
  });

  it("survives durable JSON serialization while repairing invalid input", () => {
    const created = createDurableTelemetryContext("request-123");
    const roundTrip = JSON.parse(JSON.stringify(created));

    expect(normalizeDurableTelemetryContext(roundTrip)).toEqual(created);
    expect(
      normalizeDurableTelemetryContext({
        correlationId: "bad id",
        logicalOperationId: "bad\nid",
      }),
    ).toEqual({
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      logicalOperationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      startedAtEpochMs: expect.any(Number),
    });
  });

  it("rejects malformed durable contexts at the Workflow boundary", () => {
    const valid = createDurableTelemetryContext("request-123");

    expect(requireDurableTelemetryContext(valid)).toBe(valid);
    expect(() =>
      requireDurableTelemetryContext({
        ...valid,
        startedAtEpochMs: 0,
      })
    ).toThrow("A valid durable telemetry context is required.");
    expect(() =>
      requireDurableTelemetryContext({
        ...valid,
        logicalOperationId: "bad id",
      })
    ).toThrow("A valid durable telemetry context is required.");
  });
});
