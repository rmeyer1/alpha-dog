import { describe, expect, it } from "vitest";
import {
  getEquityOptionExpirationAt,
  getNextUsEquitiesRefreshAt,
  getUsEquitiesMarketState,
  usEquitiesCalendarMetadata,
} from "./us-equities-calendar";

describe("US equities calendar", () => {
  it.each([
    {
      instant: "2026-01-19T15:00:00.000Z",
      expected: {
        holidayName: "Martin Luther King, Jr. Day",
        isMarketDay: false,
        isOpen: false,
      },
      label: "NYSE holiday",
    },
    {
      instant: "2026-06-20T15:00:00.000Z",
      expected: {
        holidayName: null,
        isMarketDay: false,
        isOpen: false,
        weekday: "Sat",
      },
      label: "weekend",
    },
    {
      instant: "2026-06-22T15:00:00.000Z",
      expected: {
        isMarketDay: true,
        isOpen: true,
        sessionType: "regular",
      },
      label: "normal session",
    },
    {
      instant: "2026-11-27T17:59:00.000Z",
      expected: {
        closeAt: "2026-11-27T18:00:00.000Z",
        isOpen: true,
        sessionType: "early_close",
      },
      label: "early-close session before 1 p.m. Eastern",
    },
    {
      instant: "2026-11-27T18:00:00.000Z",
      expected: {
        closeAt: "2026-11-27T18:00:00.000Z",
        isOpen: false,
        phase: "after_hours",
        sessionType: "early_close",
      },
      label: "early-close boundary",
    },
  ])("resolves $label from the versioned NYSE schedule", ({
    expected,
    instant,
  }) => {
    expect(getUsEquitiesMarketState(new Date(instant))).toMatchObject(expected);
  });

  it("keeps 9:30 a.m. and 4 p.m. in New York across DST", () => {
    const winter = getUsEquitiesMarketState(
      new Date("2026-01-05T14:30:00.000Z"),
    );
    const summer = getUsEquitiesMarketState(
      new Date("2026-06-08T13:30:00.000Z"),
    );

    expect(winter).toMatchObject({
      isOpen: true,
      openAt: "2026-01-05T14:30:00.000Z",
      closeAt: "2026-01-05T21:00:00.000Z",
    });
    expect(summer).toMatchObject({
      isOpen: true,
      openAt: "2026-06-08T13:30:00.000Z",
      closeAt: "2026-06-08T20:00:00.000Z",
    });
  });

  it("prewarms only on the final closed day before the next session", () => {
    expect(
      getUsEquitiesMarketState(
        new Date("2026-06-07T21:00:00.000Z"),
      ).isWeekendPrewarm,
    ).toBe(true);
    expect(
      getUsEquitiesMarketState(
        new Date("2026-09-06T21:00:00.000Z"),
      ).isWeekendPrewarm,
    ).toBe(false);
    expect(
      getUsEquitiesMarketState(
        new Date("2026-09-07T21:00:00.000Z"),
      ).isWeekendPrewarm,
    ).toBe(true);
  });

  it("moves refresh suggestions to the next actionable session boundary", () => {
    expect(
      getNextUsEquitiesRefreshAt(
        new Date("2026-06-08T15:00:00.000Z"),
        15 * 60 * 1000,
      ),
    ).toBe("2026-06-08T15:15:00.000Z");
    expect(
      getNextUsEquitiesRefreshAt(
        new Date("2026-11-27T17:55:00.000Z"),
        15 * 60 * 1000,
      ),
    ).toBe("2026-11-27T18:00:00.000Z");
    expect(
      getNextUsEquitiesRefreshAt(
        new Date("2026-09-05T17:00:00.000Z"),
        15 * 60 * 1000,
      ),
    ).toBe("2026-09-08T13:30:00.000Z");
  });

  it("anchors equity and ETF option valuation to the applicable equity close", () => {
    expect(getEquityOptionExpirationAt("2026-01-16").toISOString()).toBe(
      "2026-01-16T21:00:00.000Z",
    );
    expect(getEquityOptionExpirationAt("2026-06-19").toISOString()).toBe(
      "2026-06-18T20:00:00.000Z",
    );
    expect(getEquityOptionExpirationAt("2026-11-27").toISOString()).toBe(
      "2026-11-27T18:00:00.000Z",
    );
  });

  it("fails closed outside the maintained exchange-calendar horizon", () => {
    expect(
      getUsEquitiesMarketState(new Date("2029-01-02T15:00:00.000Z")),
    ).toMatchObject({
      calendarCovered: false,
      isMarketDay: false,
      isOpen: false,
      phase: "calendar_unavailable",
    });
    expect(() => getEquityOptionExpirationAt("2029-01-19")).toThrow(
      "outside the maintained US equities calendar",
    );
  });

  it("matches authoritative NYSE and Alpaca sample semantics", () => {
    expect(usEquitiesCalendarMetadata).toMatchObject({
      coverage: {
        start: "2026-01-01",
        end: "2028-12-31",
      },
      timeZone: "America/New_York",
    });
    expect(
      getUsEquitiesMarketState(new Date("2028-07-03T16:00:00.000Z")),
    ).toMatchObject({
      closeMinutes: 13 * 60,
      sessionType: "early_close",
    });
    expect(
      getUsEquitiesMarketState(new Date("2028-07-04T16:00:00.000Z")),
    ).toMatchObject({
      holidayName: "Independence Day",
      isMarketDay: false,
    });
  });
});
