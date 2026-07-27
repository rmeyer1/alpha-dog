import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnvMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.fn();
const acquirePaidRouteGuardMock = vi.hoisted(() => vi.fn());
const releaseGuardMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-abuse/guard", () => ({
  acquirePaidRouteGuard: acquirePaidRouteGuardMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
}));

function logoRequest(symbol = "AAPL") {
  return {
    params: Promise.resolve({ symbol }),
  };
}

function pngBytes(payloadLength = 8) {
  return new Uint8Array([
    137,
    80,
    78,
    71,
    13,
    10,
    26,
    10,
    ...new Array(payloadLength).fill(0),
  ]);
}

function chunkedResponse({
  chunks,
  contentLength,
  onCancel = vi.fn(),
}: {
  chunks: Uint8Array[];
  contentLength?: string;
  onCancel?: ReturnType<typeof vi.fn>;
}) {
  return {
    onCancel,
    response: new Response(
      new ReadableStream<Uint8Array>({
        cancel: onCancel,
        pull(controller) {
          const chunk = chunks.shift();

          if (chunk) {
            controller.enqueue(chunk);
            return;
          }

          controller.close();
        },
      }),
      {
        headers: {
          ...(contentLength === undefined
            ? {}
            : { "content-length": contentLength }),
          "content-type": "image/png",
        },
        status: 200,
      },
    ),
  };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  acquirePaidRouteGuardMock.mockReset();
  releaseGuardMock.mockReset();
  acquirePaidRouteGuardMock.mockResolvedValue({
    allowed: true,
    release: releaseGuardMock,
    signal: new AbortController().signal,
    userId: null,
    withAuthCookies: (response: Response) => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  getEnvMock.mockReturnValue({
    LOGO_DEV_BASE_URL: "https://img.logo.dev",
    LOGO_DEV_PUBLISHABLE_KEY: "pk_test",
  });
});

describe("GET /api/logos/[symbol]", () => {
  it("proxies the logo.dev ticker image with the configured token", async () => {
    fetchMock.mockResolvedValue(
      new Response(pngBytes(), {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(new Request("https://alpha-dog.test"), logoRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Alpha-Dog-Logo-Result")).toBe("logo-dev");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe(
      'inline; filename="AAPL.png"',
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://img.logo.dev/ticker/AAPL?token=pk_test&size=128&format=png&theme=dark&retina=true&fallback=404",
      }),
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(releaseGuardMock).toHaveBeenCalledTimes(1);
  });

  it("returns a non-200 diagnostic response when credentials are missing", async () => {
    getEnvMock.mockReturnValue({
      LOGO_DEV_BASE_URL: "https://img.logo.dev",
    });

    const { GET } = await import("./route");
    const response = await GET(new Request("https://alpha-dog.test"), logoRequest());

    expect(response.status).toBe(401);
    expect(response.headers.get("X-Alpha-Dog-Logo-Result")).toBe("fallback");
    expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
      "missing-credentials",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves logo.dev failure status so server logs expose fallback causes", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 404,
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(new Request("https://alpha-dog.test"), logoRequest());

    expect(response.status).toBe(404);
    expect(response.headers.get("X-Alpha-Dog-Logo-Result")).toBe("fallback");
    expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
      "upstream-unavailable",
    );
    expect(response.headers.get("X-Alpha-Dog-Logo-Upstream-Status")).toBe("404");
  });

  it.each(["text/html", "image/svg+xml", null])(
    "rejects an unexpected upstream content type %s",
    async (contentType) => {
      fetchMock.mockResolvedValue(
        new Response("not-a-png", {
          headers: contentType ? { "content-type": contentType } : undefined,
          status: 200,
        }),
      );

      const { GET } = await import("./route");
      const response = await GET(
        new Request("https://alpha-dog.test"),
        logoRequest(),
      );

      expect(response.status).toBe(502);
      expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
        "unsafe-content-type",
      );
      expect(response.headers.get("X-Alpha-Dog-Logo-Upstream-Status")).toBe(
        "200",
      );
    },
  );

  it("rejects HTML bytes even when the upstream spoofs image/png", async () => {
    fetchMock.mockResolvedValue(
      new Response("<script>alert(1)</script>", {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test"),
      logoRequest(),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
      "unsafe-image-body",
    );
  });

  it("rejects oversized upstream images before reading their body", async () => {
    const { onCancel, response: upstreamResponse } = chunkedResponse({
      chunks: [pngBytes()],
      contentLength: "1000001",
    });
    fetchMock.mockResolvedValue(upstreamResponse);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test"),
      logoRequest(),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
      "unsafe-image-body",
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it.each(["invalid", "-1", "100000000000000000000"])(
    "rejects an unsafe declared content length %s",
    async (contentLength) => {
      const { response: upstreamResponse } = chunkedResponse({
        chunks: [pngBytes()],
        contentLength,
      });
      fetchMock.mockResolvedValue(upstreamResponse);

      const { GET } = await import("./route");
      const response = await GET(
        new Request("https://alpha-dog.test"),
        logoRequest(),
      );

      expect(response.status).toBe(502);
      expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
        "unsafe-image-body",
      );
    },
  );

  it("stops and cancels a chunked oversized body without content-length", async () => {
    const { onCancel, response: upstreamResponse } = chunkedResponse({
      chunks: [
        pngBytes(499_992),
        new Uint8Array(500_001),
        new Uint8Array([1]),
      ],
    });
    fetchMock.mockResolvedValue(upstreamResponse);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test"),
      logoRequest(),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
      "unsafe-image-body",
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(releaseGuardMock).toHaveBeenCalledTimes(1);
  });

  it("does not trust an understated content-length", async () => {
    const { response: upstreamResponse } = chunkedResponse({
      chunks: [pngBytes(999_992), new Uint8Array([1])],
      contentLength: "16",
    });
    fetchMock.mockResolvedValue(upstreamResponse);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test"),
      logoRequest(),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
      "unsafe-image-body",
    );
  });

  it("accepts a valid PNG whose body is exactly the byte limit", async () => {
    const exactLimitPng = pngBytes(999_992);
    const { response: upstreamResponse } = chunkedResponse({
      chunks: [
        exactLimitPng.subarray(0, 500_000),
        exactLimitPng.subarray(500_000),
      ],
      contentLength: "1000000",
    });
    fetchMock.mockResolvedValue(upstreamResponse);

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test"),
      logoRequest(),
    );

    expect(response.status).toBe(200);
    expect((await response.arrayBuffer()).byteLength).toBe(1_000_000);
  });

  it("fails closed and releases the paid-route guard when a body read fails", async () => {
    const failure = new Error("upstream read failed");
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(failure);
          },
        }),
        {
          headers: { "content-type": "image/png" },
          status: 200,
        },
      ),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new Request("https://alpha-dog.test"),
      logoRequest(),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("X-Alpha-Dog-Logo-Reason")).toBe(
      "unsafe-image-body",
    );
    expect(releaseGuardMock).toHaveBeenCalledTimes(1);
  });
});
