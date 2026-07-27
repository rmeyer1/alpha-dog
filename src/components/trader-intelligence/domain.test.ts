import { describe, expect, it } from "vitest";
import {
  appliedFilterLabel,
  defaultTraderFilters,
  formatPercent,
  shortWallet,
} from "./domain";
import { asyncRequestReducer, initialAsyncRequestState } from "./request-state";

describe("trader intelligence domain helpers", () => {
  it("formats filter provenance and wallet identifiers consistently", () => {
    expect(appliedFilterLabel(defaultTraderFilters)).toBe(
      "OVERALL · WEEK · PNL · 25 rows",
    );
    expect(shortWallet("0x1234567890123456789012345678901234567890")).toBe(
      "0x1234...7890",
    );
    expect(formatPercent(null)).toBe("n/a");
    expect(formatPercent(0.125)).toBe("12.50%");
  });
});

describe("async request reducer", () => {
  it("models refresh and failure transitions without losing an error", () => {
    const refreshing = asyncRequestReducer(
      { ...initialAsyncRequestState, listState: "success" },
      { type: "list/start" },
    );
    expect(refreshing).toMatchObject({
      listError: null,
      listState: "refreshing",
    });
    const failed = asyncRequestReducer(refreshing, {
      type: "list/error",
      message: "Unavailable",
    });
    expect(failed).toMatchObject({
      listError: "Unavailable",
      listState: "error",
    });
  });
});
