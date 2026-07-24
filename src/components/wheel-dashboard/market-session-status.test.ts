// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getUsEquitiesMarketState } from "@/lib/market/us-equities-calendar";
import type { PersonaConfig, WheelFilters } from "@/lib/wheel/types";
import { ScreenerStatusStrip } from "../wheel-dashboard";
import {
  getMarketSessionView,
} from "./market-session-status";

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getMarketSessionView", () => {
  it("uses the shared calendar state for an early close", () => {
    const view = getMarketSessionView(
      getUsEquitiesMarketState(new Date("2026-11-27T17:45:00.000Z")),
    );

    expect(view.label).toBe("Open · early close");
    expect(view.detail).toContain("1:00 PM EST");
  });

  it("names exchange holidays instead of reporting a weekday session", () => {
    const view = getMarketSessionView(
      getUsEquitiesMarketState(new Date("2026-07-03T15:00:00.000Z")),
    );

    expect(view.label).toBe("Closed");
    expect(view.detail).toBe("Independence Day (observed)");
  });
});

describe("MarketSessionStatusTile", () => {
  it("updates the composed tile atomically at a session boundary and cleans up its timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T13:29:59.500Z"));

    const initialState = getUsEquitiesMarketState(new Date());
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => {
      root.render(
        createElement(ScreenerStatusStrip, {
          activePersona: { name: "Balanced wheel" } as PersonaConfig,
          error: null,
          filters: {
            deltaMax: 0.3,
            deltaMin: 0.15,
            dteMax: 45,
            dteMin: 21,
          } as WheelFilters,
          marketState: initialState,
          requestState: "idle",
          response: null,
          screenerResponse: null,
          strategy: "short_put",
          tab: "puts",
          ticker: "",
        }),
      );
    });

    const tile = container.firstElementChild;
    const marketTile = container.querySelector("[data-market-phase]");

    expect(marketTile?.getAttribute("data-market-phase")).toBe("pre_market");
    expect(marketTile?.getAttribute("role")).toBe("status");
    expect(marketTile?.parentElement?.classList.contains("grid")).toBe(true);
    expect(marketTile?.classList.contains("border-cyan-300/30")).toBe(true);
    expect(marketTile?.classList.contains("bg-cyan-400/10")).toBe(true);
    expect(marketTile?.textContent).toContain("Pre-market");
    expect(marketTile?.querySelectorAll("svg")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(marketTile?.getAttribute("data-market-phase")).toBe("open");
    expect(marketTile?.classList.contains("border-emerald-300/30")).toBe(true);
    expect(marketTile?.classList.contains("bg-emerald-400/10")).toBe(true);
    expect(marketTile?.classList.contains("border-cyan-300/30")).toBe(false);
    expect(marketTile?.classList.contains("bg-cyan-400/10")).toBe(false);
    expect(marketTile?.textContent).toContain("Open · closes 4:00 PM EDT");
    expect(marketTile?.querySelectorAll("svg")).toHaveLength(1);
    expect(tile?.querySelectorAll("[data-market-phase]")).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      root.unmount();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
