import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFinnhubEarningsCalendar,
  normalizeFinnhubEarningsEvent,
} from "./client";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("FINNHUB_API_KEY", "test-key");
});

describe("Finnhub client", () => {
  it("normalizes earnings calendar rows", () => {
    expect(
      normalizeFinnhubEarningsEvent({
        date: "2026-07-15",
        epsActual: undefined,
        epsEstimate: 1.23,
        hour: "AMC",
        quarter: 2,
        revenueActual: null,
        revenueEstimate: 123456,
        symbol: " aapl ",
        year: 2026,
      }),
    ).toEqual({
      date: "2026-07-15",
      epsActual: null,
      epsEstimate: 1.23,
      hour: "amc",
      quarter: 2,
      revenueActual: null,
      revenueEstimate: 123456,
      symbol: "AAPL",
      year: 2026,
    });
  });

  it("fetches earnings calendar with date-window params", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        earningsCalendar: [
          {
            date: "2026-07-15",
            epsEstimate: 1.23,
            hour: "bmo",
            quarter: 2,
            symbol: "MSFT",
            year: 2026,
          },
        ],
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const rows = await getFinnhubEarningsCalendar({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    const url = new URL(fetchMock.mock.calls[0][0]);

    expect(url.pathname).toBe("/api/v1/calendar/earnings");
    expect(url.searchParams.get("from")).toBe("2026-07-01");
    expect(url.searchParams.get("to")).toBe("2026-07-31");
    expect(url.searchParams.get("token")).toBe("test-key");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "MSFT", hour: "bmo" });
  });
});
