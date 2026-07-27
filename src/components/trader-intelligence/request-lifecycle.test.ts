// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraderIntelligence } from "../trader-intelligence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function leaderboard(userName: string) {
  return {
    dataFreshness: {
      asOf: "2026-07-27T18:00:00.000Z",
      cacheStatus: "fresh",
      cachedUntil: "2026-07-27T18:05:00.000Z",
      source: "polymarket",
    },
    traders: [
      {
        labels: ["Recent momentum"],
        pnl: 1250,
        pnlPerVolume: 0.25,
        profileImage: null,
        proxyWallet: "0x56687bf447db6ffa42ffe2204a05edaa20f55839",
        rank: 1,
        scores: {
          activityScore: 80,
          alphaDogScore: 88,
          edgeScore: 90,
          profitabilityScore: 85,
        },
        userName,
        verifiedBadge: false,
        volume: 5000,
        xUsername: null,
      },
    ],
  };
}

function whales() {
  return {
    criteria: {
      category: "OVERALL",
      minValue: 10000,
      orderBy: "PNL",
      timePeriod: "WEEK",
    },
    dataFreshness: {
      asOf: "2026-07-27T18:00:00.000Z",
      cacheStatus: "fresh",
      cachedUntil: "2026-07-27T18:05:00.000Z",
      source: "polymarket",
    },
    whales: [],
  };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) {
      return;
    }

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  throw new Error("Timed out waiting for component state");
}

function button(container: HTMLElement, label: string) {
  return [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
}

let root: Root | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  root = null;
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TraderIntelligence request lifecycle", () => {
  it("uses refreshing after success and rejects a superseded response", async () => {
    const staleRefresh = deferred<Response>();
    let staleRefreshSignal: AbortSignal | null = null;
    let leaderboardCalls = 0;
    const fetchMock = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input);

        if (url.startsWith("/api/polymarket/leaderboard?")) {
          leaderboardCalls += 1;

          if (leaderboardCalls === 1) {
            return Promise.resolve(
              Response.json(leaderboard("Initial Signal")),
            );
          }

          if (leaderboardCalls === 2) {
            staleRefreshSignal = init?.signal ?? null;
            return staleRefresh.promise;
          }

          return Promise.resolve(
            Response.json(leaderboard("Current Signal")),
          );
        }

        if (url.startsWith("/api/polymarket/whales?")) {
          return Promise.resolve(Response.json(whales()));
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/traders");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(createElement(TraderIntelligence));
    });
    await waitFor(() => container.textContent?.includes("Initial Signal") ?? false);

    await act(async () => {
      button(container, "Refresh")?.click();
    });
    await waitFor(() => leaderboardCalls === 2);

    expect(button(container, "Refresh")?.disabled).toBe(true);
    expect(container.textContent).toContain("Initial Signal");
    expect(container.textContent).not.toContain("Loading traders...");

    await act(async () => {
      button(container, "Whales")?.click();
    });
    await waitFor(() => container.textContent?.includes(
      "No whale candidates matched this view.",
    ) ?? false);
    expect(staleRefreshSignal?.aborted).toBe(true);

    await act(async () => {
      button(container, "Top Traders")?.click();
    });
    await waitFor(() => container.textContent?.includes("Current Signal") ?? false);

    await act(async () => {
      staleRefresh.resolve(Response.json(leaderboard("Stale Signal")));
      await staleRefresh.promise;
    });

    expect(container.textContent).toContain("Current Signal");
    expect(container.textContent).not.toContain("Stale Signal");
  });
});
