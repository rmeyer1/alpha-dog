import { beforeEach, describe, expect, it, vi } from "vitest";

const registerOTelMock = vi.hoisted(() => vi.fn());

vi.mock("@vercel/otel", () => ({
  registerOTel: registerOTelMock,
}));

beforeEach(() => {
  registerOTelMock.mockReset();
});

describe("OpenTelemetry registration", () => {
  it("ignores raw third-party fetch spans and denies trace propagation", async () => {
    const { register } = await import("./instrumentation");

    register();

    expect(registerOTelMock).toHaveBeenCalledOnce();
    const configuration = registerOTelMock.mock.calls[0]?.[0];
    const fetch = configuration?.instrumentationConfig?.fetch;

    expect(configuration?.serviceName).toBe("alpha-dog");
    expect(fetch?.propagateContextUrls).toEqual([]);
    expect(fetch?.ignoreUrls).toHaveLength(6);
    expect(fetch?.dontPropagateContextUrls).toEqual(fetch?.ignoreUrls);

    for (const url of [
      "https://data.alpaca.markets/v2/stocks/SECRET",
      "https://finnhub.io/api/v1/profile?token=SECRET",
      "https://img.logo.dev/ticker/SECRET?token=SECRET",
      "https://api.openai.com/v1/responses",
      "https://data-api.polymarket.com/positions?user=SECRET",
      "https://project.supabase.co/rest/v1/table?select=SECRET",
    ]) {
      expect(
        fetch.ignoreUrls.some((matcher: RegExp) => matcher.test(url)),
      ).toBe(true);
    }
  });
});
