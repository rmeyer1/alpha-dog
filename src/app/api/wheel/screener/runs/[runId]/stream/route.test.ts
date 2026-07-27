import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acquirePaidRouteGuard: vi.fn(),
  cancel: vi.fn(),
  getRun: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/api-abuse/guard", () => ({
  acquirePaidRouteGuard: mocks.acquirePaidRouteGuard,
}));

vi.mock("@/lib/observability/route", () => ({
  instrumentApiRoute: (
    _metadata: unknown,
    handler: (...args: never[]) => unknown,
  ) => handler,
}));

vi.mock("workflow/api", () => ({
  getRun: mocks.getRun,
}));

function context(runId = "run-1") {
  return { params: Promise.resolve({ runId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acquirePaidRouteGuard.mockResolvedValue({
    allowed: true,
    release: mocks.release,
    withAuthCookies: (response: Response) => response,
  });
});

describe("wheel screener progress stream", () => {
  it("rejects a missing workflow run ID before acquiring a lease", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/stream"),
      context(""),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "MISSING_RUN_ID" },
    });
    expect(mocks.acquirePaidRouteGuard).not.toHaveBeenCalled();
  });

  it("returns the paid-route denial without opening a workflow stream", async () => {
    const denial = Response.json(
      { error: { code: "RATE_LIMITED" } },
      { status: 429 },
    );
    mocks.acquirePaidRouteGuard.mockResolvedValue({
      allowed: false,
      response: denial,
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/stream"),
      context(),
    );

    expect(response).toBe(denial);
    expect(mocks.getRun).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });

  it("returns a stable not-found response and releases the lease", async () => {
    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(false),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/stream"),
      context(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      error: { code: "SCREENER_RUN_NOT_FOUND" },
    });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("preserves NDJSON chunks, termination, headers, and cancellation", async () => {
    const encoder = new TextEncoder();
    const source = new ReadableStream<Uint8Array>({
      cancel: mocks.cancel,
      start(controller) {
        controller.enqueue(encoder.encode('{"status":"started"}\n'));
        controller.enqueue(encoder.encode('{"status":"complete"}\n'));
        controller.close();
      },
    });

    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(true),
      getReadable: vi.fn(() => source),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/stream"),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    const reader = response.body!.getReader();
    const first = await reader.read();
    const second = await reader.read();
    const end = await reader.read();

    expect(new TextDecoder().decode(first.value)).toBe(
      '{"status":"started"}\n',
    );
    expect(new TextDecoder().decode(second.value)).toBe(
      '{"status":"complete"}\n',
    );
    expect(end.done).toBe(true);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("passes downstream cancellation to the workflow stream", async () => {
    const source = new ReadableStream<Uint8Array>({
      cancel: mocks.cancel,
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":"started"}\n'));
      },
    });

    mocks.getRun.mockReturnValue({
      exists: Promise.resolve(true),
      getReadable: vi.fn(() => source),
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/stream"),
      context(),
    );

    await response.body!.cancel("client-disconnected");

    expect(mocks.cancel).toHaveBeenCalledWith("client-disconnected");
  });

  it("returns a stable JSON error without changing stream policy", async () => {
    mocks.getRun.mockImplementation(() => {
      throw new Error("workflow unavailable");
    });

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test/api/stream"),
      context(),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL_SCREENER_STREAM_ERROR" },
    });
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
