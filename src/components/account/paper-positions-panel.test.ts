// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  lifecycleLabel,
  lifecycleRows,
  mergePositionRows,
  PaperPositionsPanel,
  reconcilePositionPages,
  validateClosePositionInput,
} from "./paper-positions-panel";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const assignedLifecycle = {
  cashDelta: -38_000,
  effectiveAt: "2026-08-21T21:00:00.000Z",
  eventId: "event-1",
  eventType: "assigned",
  marginDelta: 28_000,
  metadata: {
    assignmentCost: 38_000,
    costBasis: 190,
    shares: 200,
    underlyingPriceAtExpiration: 180,
  },
  outcome: "assigned" as const,
  price: 190,
  quantity: 2,
  realizedPnlDelta: 250,
};

describe("lifecycleLabel", () => {
  it("uses lifecycle outcome labels before raw status labels", () => {
    expect(lifecycleLabel("closed", {
      ...assignedLifecycle,
      outcome: "expired_otm",
    })).toBe("Expired OTM");
    expect(lifecycleLabel("closed", assignedLifecycle)).toBe("Assigned");
    expect(lifecycleLabel("called_away", {
      ...assignedLifecycle,
      eventType: "called_away",
      outcome: "called_away",
    })).toBe("Called away");
    expect(lifecycleLabel("manual_review", {
      ...assignedLifecycle,
      eventType: "manual_adjustment",
      outcome: "manual_review",
    })).toBe("Manual review");
  });

  it("falls back to readable status labels without lifecycle context", () => {
    expect(lifecycleLabel("partially_closed")).toBe("Partially Closed");
    expect(lifecycleLabel("closed")).toBe("Closed");
  });
});

describe("lifecycleRows", () => {
  it("exposes called-away backend metadata and fallbacks without local inference", () => {
    expect(lifecycleRows({
      cashDelta: 42_000,
      effectiveAt: "2026-08-21T21:00:00.000Z",
      eventId: "event-2",
      eventType: "called_away",
      marginDelta: 0,
      metadata: {
        calledAwayPrice: 210,
        calledAwayProceeds: 42_000,
        costBasis: 180,
        remainingLotShares: 100,
        shares: 200,
        sourceLotId: "lot-1",
        sourcePositionId: "assigned-put-position-1",
        underlyingPriceAtExpiration: 220,
      },
      outcome: "called_away",
      price: 210,
      quantity: 2,
      realizedPnlDelta: 6_500,
    })).toEqual([
      ["Effective date", "Aug 21, 2026"],
      ["Shares called away", "200"],
      ["Call-away price", "$210.00"],
      ["Call-away proceeds", "$42,000.00"],
      ["Cost basis", "$180.00"],
      ["Cash impact", "$42,000.00"],
      ["Realized P/L", "$6,500.00"],
      ["Underlying at expiration", "$220.00"],
      ["Source lot", "lot-1"],
      ["Source position", "assigned-put-position-1"],
      ["Remaining lot shares", "100"],
    ]);
  });

  it("keeps called-away rows readable when optional metadata is missing", () => {
    expect(lifecycleRows({
      cashDelta: 42_000,
      effectiveAt: "2026-08-21T21:00:00.000Z",
      eventId: "event-2",
      eventType: "called_away",
      marginDelta: 0,
      metadata: {},
      outcome: "called_away",
      price: 210,
      quantity: 2,
      realizedPnlDelta: 500,
    })).toContainEqual(["Source lot", "Unavailable"]);
  });
});

describe("validateClosePositionInput", () => {
  const validInput = {
    closedAt: "2026-07-05",
    closePrice: "0.65",
    contracts: "1",
    remainingContracts: 2,
  };

  it("accepts a positive whole quantity within the remaining contracts", () => {
    expect(validateClosePositionInput(validInput)).toEqual({ valid: true });
  });

  it("rejects invalid quantities and prices with production messages", () => {
    expect(validateClosePositionInput({
      ...validInput,
      contracts: "0",
    })).toEqual({
      message: "Contracts bought back must be a whole number above zero.",
      valid: false,
    });
    expect(validateClosePositionInput({
      ...validInput,
      closePrice: "-0.01",
    })).toEqual({
      message: "Buyback price must be zero or greater.",
      valid: false,
    });
  });

  it("marks over-close attempts as stale so the UI can prompt refresh", () => {
    expect(validateClosePositionInput({
      ...validInput,
      contracts: "3",
    })).toEqual({
      message: "Contracts bought back cannot exceed the remaining quantity.",
      stale: true,
      valid: false,
    });
  });

  it("requires a close date for the lifecycle event", () => {
    expect(validateClosePositionInput({
      ...validInput,
      closedAt: "",
    })).toEqual({
      message: "Close date is required.",
      valid: false,
    });
  });
});

describe("position page accumulation", () => {
  it("deduplicates retries by immutable position ID", () => {
    expect(mergePositionRows(
      [
        { id: "position-1", symbol: "OLD" },
        { id: "position-2", symbol: "MSFT" },
      ] as never,
      [
        { id: "position-1", symbol: "AAPL" },
        { id: "position-3", symbol: "NVDA" },
      ] as never,
    )).toEqual([
      { id: "position-1", symbol: "AAPL" },
      { id: "position-2", symbol: "MSFT" },
      { id: "position-3", symbol: "NVDA" },
    ]);
  });

  it("moves a closed row out of accumulated open pages without duplicates", () => {
    const pages = {
      history: {
        items: [{ id: "history-1", status: "closed" }],
        nextCursor: "history-next",
        total: 1,
      },
      open: {
        items: [
          { id: "moving", status: "open" },
          { id: "open-2", status: "open" },
        ],
        nextCursor: "open-next",
        total: 2,
      },
    } as never;
    const reconciled = reconcilePositionPages(pages, "history", {
      items: [
        { id: "moving", status: "closed" },
        { id: "history-1", status: "closed" },
      ],
      nextCursor: null,
      total: 2,
    } as never);

    expect(reconciled.open.items).toEqual([
      { id: "open-2", status: "open" },
    ]);
    expect(reconciled.history.items).toEqual([
      { id: "history-1", status: "closed" },
      { id: "moving", status: "closed" },
    ]);
  });

  it("preserves the active tab and load-more focus through a terminal page", async () => {
    const position = (
      id: string,
      status: string,
      symbol: string,
    ) => ({
      closedAt: status === "open" ? null : "2026-07-23T12:00:00.000Z",
      contractsOpened: 1,
      contractsRemaining: status === "open" ? 1 : 0,
      dataProvenance: {
        asOf: null,
        cacheSource: null,
        cacheStatus: null,
        feed: null,
        sourceMode: "unknown",
      },
      expirationDate: "2026-08-21",
      id,
      lifecycle: null,
      netCredit: 1.25,
      notes: null,
      openedAt: "2026-07-20T12:00:00.000Z",
      source: "simulated",
      status,
      strategyType: "short_put",
      symbol,
      underlyingPriceAtOpen: 25,
      valuation: {
        markStatus: "available",
        markToClose: status === "open" ? 100 : 0,
        openExposure: status === "open" ? 2_500 : 0,
        premiumRemaining: status === "open" ? 125 : 0,
        unrealizedPnl: status === "open" ? 25 : 0,
      },
    });
    const initial = {
      pages: {
        history: {
          items: [position("history-1", "closed", "MSFT")],
          nextCursor: "history-cursor",
          total: 2,
        },
        open: {
          items: [position("open-1", "open", "AAPL")],
          nextCursor: "open-cursor",
          total: 2,
        },
      },
    };
    const finalHistory = {
      pages: {
        history: {
          items: [
            position("history-1", "closed", "MSFT"),
            position("history-2", "expired", "NVDA"),
          ],
          nextCursor: null,
          total: 2,
        },
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(initial)))
      .mockResolvedValueOnce(new Response(JSON.stringify(finalHistory)));
    vi.stubGlobal("fetch", fetchMock);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(PaperPositionsPanel));
    });

    const historyTab = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "History (2)",
    );
    expect(historyTab).toBeDefined();

    act(() => {
      historyTab?.click();
    });

    const loadMore = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Load more historical positions",
    );
    expect(loadMore).toBeDefined();
    loadMore?.focus();

    await act(async () => {
      loadMore?.click();
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/account/positions?scope=history&historyCursor=history-cursor",
      { cache: "no-store" },
    );
    expect(container.textContent).toContain("MSFT");
    expect(container.textContent).toContain("NVDA");
    expect(container.textContent?.match(/MSFT/g)).toHaveLength(2);
    expect(loadMore?.textContent).toBe("All historical positions loaded");
    expect(loadMore?.getAttribute("aria-busy")).toBe("false");
    expect(document.activeElement).toBe(loadMore);
    expect(historyTab?.className).toContain("bg-emerald-300");

    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
});
