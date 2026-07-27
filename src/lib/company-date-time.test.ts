import { describe, expect, it } from "vitest";
import {
  COMPANY_DISPLAY_TIME_ZONE,
  formatCompanyDate,
  formatCompanyDateTime,
  formatCompanyNewsDate,
} from "./company-date-time";

describe("company date and time formatting", () => {
  it("documents UTC as the canonical company display timezone", () => {
    expect(COMPANY_DISPLAY_TIME_ZONE).toBe("UTC");
  });

  it("formats an ordinary timestamp with an explicit timezone", () => {
    expect(formatCompanyDateTime("2026-07-25T08:28:00.000Z")).toBe(
      "Jul 25, 2026, 8:28 AM UTC",
    );
    expect(formatCompanyNewsDate(1_784_968_080)).toBe(
      "Jul 25, 8:28 AM UTC",
    );
  });

  it("normalizes an offset-qualified instant to UTC", () => {
    expect(formatCompanyDateTime("2026-07-25T04:28:00-04:00")).toBe(
      "Jul 25, 2026, 8:28 AM UTC",
    );
    expect(formatCompanyDate("2026-07-24T23:30:00-02:00")).toBe(
      "Jul 25, 2026",
    );
    expect(formatCompanyDateTime("2026-07-25T00:30:00+02:00")).toBe(
      "Jul 24, 2026, 10:30 PM UTC",
    );
  });

  it("constructs noon and afternoon labels without locale data", () => {
    expect(formatCompanyDateTime("2026-07-25T12:05:00Z")).toBe(
      "Jul 25, 2026, 12:05 PM UTC",
    );
    expect(formatCompanyDateTime("2026-07-25T23:05:00Z")).toBe(
      "Jul 25, 2026, 11:05 PM UTC",
    );
  });

  it("preserves the UTC date at a local-midnight boundary", () => {
    expect(formatCompanyDateTime("2026-01-01T00:30:00.000Z")).toBe(
      "Jan 1, 2026, 12:30 AM UTC",
    );
  });

  it("formats date-only input without shifting the calendar day", () => {
    expect(formatCompanyDate("2026-07-25")).toBe("Jul 25, 2026");
    expect(formatCompanyDate("2024-02-29")).toBe("Feb 29, 2024");
    expect(formatCompanyDate("2000-02-29")).toBe("Feb 29, 2000");
    expect(formatCompanyDate("2100-02-29")).toBe("-");
  });

  it.each([
    [
      "spring-forward before",
      "2026-03-08T06:59:59.000Z",
      "Mar 8, 2026, 6:59 AM UTC",
    ],
    [
      "spring-forward after",
      "2026-03-08T07:00:00.000Z",
      "Mar 8, 2026, 7:00 AM UTC",
    ],
    [
      "fall-back before",
      "2026-11-01T05:59:59.000Z",
      "Nov 1, 2026, 5:59 AM UTC",
    ],
    [
      "fall-back after",
      "2026-11-01T06:00:00.000Z",
      "Nov 1, 2026, 6:00 AM UTC",
    ],
  ])("formats the %s DST boundary deterministically", (_label, value, expected) => {
    expect(formatCompanyDateTime(value)).toBe(expected);
  });

  it.each([
    ["invalid text", "not-a-date"],
    ["invalid date-only day", "2026-02-29"],
    ["normalized date-time day", "2026-02-30T08:28:00Z"],
    ["invalid clock minute", "2026-07-25T08:60:00Z"],
    ["invalid clock second", "2026-07-25T08:28:60Z"],
    ["zone-less date-time", "2026-07-25T08:28:00"],
    ["date-only value", "2026-07-25"],
    ["invalid offset", "2026-07-25T08:28:00+24:00"],
    ["invalid offset minute", "2026-07-25T08:28:00+02:60"],
  ])("rejects the %s as an instant", (_label, value) => {
    expect(formatCompanyDateTime(value)).toBe("-");
  });

  it.each([
    ["malformed date-only", "2026-7-25"],
    ["invalid date-only month", "2026-13-01"],
    ["invalid date-only day", "2026-04-31"],
    ["zone-less date-time", "2026-07-25T08:28:00"],
  ])("rejects the %s as a display date", (_label, value) => {
    expect(formatCompanyDate(value)).toBe("-");
  });

  it("rejects invalid numeric news timestamps", () => {
    expect(formatCompanyNewsDate(Number.NaN)).toBe("-");
    expect(formatCompanyNewsDate(Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatCompanyNewsDate(1.5)).toBe("-");
    expect(formatCompanyNewsDate(Number.MAX_SAFE_INTEGER)).toBe("-");
  });

  it("preserves empty-value placeholders", () => {
    expect(formatCompanyDate(null)).toBe("-");
    expect(formatCompanyDateTime(undefined)).toBe("-");
    expect(formatCompanyNewsDate(null)).toBe("-");
  });
});
