import { beforeEach, describe, expect, it, vi } from "vitest";

const getEnvMock = vi.hoisted(() => vi.fn());
const fetchMock = vi.fn();

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
}));

function logoRequest(symbol = "AAPL") {
  return {
    params: Promise.resolve({ symbol }),
  };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  getEnvMock.mockReturnValue({
    LOGO_DEV_BASE_URL: "https://img.logo.dev",
    LOGO_DEV_PUBLISHABLE_KEY: "pk_test",
  });
});

describe("GET /api/logos/[symbol]", () => {
  it("proxies the logo.dev ticker image with the configured token", async () => {
    fetchMock.mockResolvedValue(
      new Response("image-bytes", {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(new Request("https://alpha-dog.test"), logoRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Alpha-Dog-Logo-Result")).toBe("logo-dev");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://img.logo.dev/ticker/AAPL?token=pk_test&format=png&theme=dark&retina=true&fallback=404",
      }),
      expect.objectContaining({ cache: "no-store" }),
    );
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
});
