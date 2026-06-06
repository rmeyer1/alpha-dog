import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

function stubLiveEnv() {
  vi.stubEnv("APCA_API_KEY_ID", "key");
  vi.stubEnv("APCA_API_SECRET_KEY", "secret");
  vi.stubEnv("ALPACA_TRADING_BASE_URL", "https://paper-api.alpaca.markets");
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    json: async () => body,
  };
}

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("Alpaca client", () => {
  it("keeps optionable NYSE and NASDAQ assets when Alpaca omits asset_class", async () => {
    stubLiveEnv();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse([
          {
            symbol: "ZIP",
            name: "Zip Co.",
            status: "active",
            tradable: true,
            exchange: "NYSE",
            attributes: ["has_options"],
          },
          {
            symbol: "NOPE",
            name: "No Options Co.",
            status: "active",
            tradable: true,
            exchange: "NYSE",
            attributes: [],
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            symbol: "AAPL",
            name: "Apple Inc.",
            status: "active",
            tradable: true,
            exchange: "NASDAQ",
            attributes: ["fractional_eh_enabled", "has_options"],
          },
        ]),
      );

    const { getWheelAssetUniverse } = await import("./client");

    await expect(getWheelAssetUniverse()).resolves.toEqual([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        exchange: "NASDAQ",
      },
      {
        symbol: "ZIP",
        name: "Zip Co.",
        exchange: "NYSE",
      },
    ]);

    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
