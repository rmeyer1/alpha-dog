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
    ALPACA_LOGO_BASE_URL: "https://broker-api.sandbox.alpaca.markets",
    APCA_API_KEY_ID: "key",
    APCA_API_SECRET_KEY: "secret",
  });
});

describe("GET /api/logos/[symbol]", () => {
  it("proxies the Alpaca image with both supported auth header styles", async () => {
    fetchMock.mockResolvedValue(
      new Response("image-bytes", {
        headers: { "content-type": "image/png" },
        status: 200,
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(new Request("https://alpha-dog.test"), logoRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Alpha-Dog-Logo-Result")).toBe("alpaca");
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://broker-api.sandbox.alpaca.markets/v1beta1/logos/AAPL?placeholder=false",
      }),
      expect.objectContaining({
        headers: expect.objectContaining({
          "APCA-API-KEY-ID": "key",
          "APCA-API-SECRET-KEY": "secret",
          Authorization: "Basic a2V5OnNlY3JldA==",
        }),
      }),
    );
  });

  it("returns a non-200 diagnostic response when credentials are missing", async () => {
    getEnvMock.mockReturnValue({
      ALPACA_LOGO_BASE_URL: "https://broker-api.sandbox.alpaca.markets",
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

  it("preserves Alpaca failure status so server logs expose fallback causes", async () => {
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
