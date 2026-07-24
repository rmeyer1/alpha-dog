import { describe, expect, it } from "vitest";
import {
  CORRELATION_HEADER,
  correlationIdFromRequest,
  createDurableTelemetryContext,
  normalizeCorrelationId,
  normalizeDurableTelemetryContext,
} from "./context";

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

  it("replaces unsafe caller identifiers instead of reflecting them", () => {
    const unsafe = "secret@example.test Bearer-token-canary";
    const request = new Request("https://alpha-dog.test/api/test", {
      headers: { [CORRELATION_HEADER]: unsafe },
    });
    const correlationId = correlationIdFromRequest(request);

    expect(correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(correlationId).not.toContain(unsafe);
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
    });
  });
});
