import { describe, expect, it, vi } from "vitest";
import { CORRELATION_HEADER } from "./context";
import { instrumentApiRoute } from "./route";

function telemetryRecords(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map(([value]) => String(value))
    .filter((value) => value.includes('"event":"api.request"'))
    .map((value) => JSON.parse(value));
}

describe("API route telemetry boundary", () => {
  it("returns one correlation header and one server event for a failed response", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "POST", route: "/api/example/[id]" },
      async () => Response.json({ error: { code: "INVALID" } }, {
        status: 400,
      }),
    );
    const request = new Request("https://alpha-dog.test/api/example/123", {
      headers: { [CORRELATION_HEADER]: "caller-request-1" },
      method: "POST",
    });
    const response = await handler(request);
    const records = telemetryRecords(warn);
    const serverCorrelationId = response.headers.get(CORRELATION_HEADER);

    expect(response.status).toBe(400);
    expect(serverCorrelationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(serverCorrelationId).not.toBe("caller-request-1");
    expect(records).toEqual([expect.objectContaining({
      clientCorrelationId: "caller-request-1",
      correlationId: serverCorrelationId,
      errorCode: "HTTP_400",
      httpStatus: 400,
      outcome: "client_error",
      route: "/api/example/[id]",
    })]);

    warn.mockRestore();
  });

  it("keeps repeated caller IDs secondary to unique server identities", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "GET", route: "/api/example" },
      async () => Response.json({ ok: true }),
    );
    const request = () => new Request("https://alpha-dog.test/api/example", {
      headers: { [CORRELATION_HEADER]: "repeated-caller-1" },
    });
    const first = await handler(request());
    const second = await handler(request());

    expect(first.headers.get(CORRELATION_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.headers.get(CORRELATION_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.headers.get(CORRELATION_HEADER)).not.toBe(
      first.headers.get(CORRELATION_HEADER),
    );

    for (const record of telemetryRecords(info)) {
      expect(record.clientCorrelationId).toBe("repeated-caller-1");
    }

    info.mockRestore();
  });

  it("maps thrown values to a safe response without leaking exception content", async () => {
    const secret = "raw-provider-body-canary@example.test";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "GET", route: "/api/example" },
      async () => {
        throw { body: secret, stack: secret, token: secret };
      },
    );
    const response = await handler(
      new Request("https://alpha-dog.test/api/example"),
    );
    const serialized = JSON.stringify(await response.json()) +
      errorLog.mock.calls.flat().join(" ");

    expect(response.status).toBe(500);
    expect(response.headers.get(CORRELATION_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("stack");

    errorLog.mockRestore();
  });

  it("redacts nested sensitive values from returned API error bodies", async () => {
    const canary = "provider-body-canary@example.test";
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "GET", route: "/api/example" },
      async () => Response.json({
        error: {
          code: "UPSTREAM_FAILED",
          details: {
            headers: { authorization: `Bearer ${canary}` },
            prompt: canary,
            rows: [{ wallet: `0x1234567890abcdef-${canary}` }],
          },
          message: `Provider returned ${canary}`,
        },
      }, { status: 502 }),
    );
    const response = await handler(
      new Request("https://alpha-dog.test/api/example"),
    );
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(serialized).toContain("UPSTREAM_FAILED");
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain("0x1234567890abcdef");

    errorLog.mockRestore();
  });

  it("replaces control, Unicode, whitespace, and oversized caller IDs", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const handler = instrumentApiRoute(
      { method: "GET", route: "/api/example" },
      async () => Response.json({ ok: true }),
    );

    for (const value of [
      " leading",
      "trailing ",
      "line break",
      "réquest-confusable",
      "x".repeat(65),
    ]) {
      const response = await handler(new Request(
        "https://alpha-dog.test/api/example",
        { headers: { [CORRELATION_HEADER]: value } },
      ));

      expect(response.headers.get(CORRELATION_HEADER)).toMatch(
        /^[0-9a-f-]{36}$/,
      );
      expect(response.headers.get(CORRELATION_HEADER)).not.toBe(value);
    }

    info.mockRestore();
  });
});
