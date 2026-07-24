import { createRoot } from "react-dom/client";
import { PaperPositionsPanel } from "../../../src/components/account/paper-positions-panel";

declare global {
  interface Window {
    __ad011BenchmarkPayloadBytes: number;
    __ad011Requests: string[];
  }
}

function position(
  id: string,
  status: string,
  symbol: string,
) {
  return {
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
  };
}

const responses = new Map<string, unknown>([
  [
    "/api/account/positions",
    {
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
    },
  ],
  [
    "/api/account/positions?scope=open&openCursor=open-cursor",
    {
      pages: {
        open: {
          items: [position("open-2", "open", "NVDA")],
          nextCursor: null,
          total: 2,
        },
      },
    },
  ],
  [
    "/api/account/positions?scope=history&historyCursor=history-cursor",
    {
      pages: {
        history: {
          items: [position("history-2", "expired", "TSLA")],
          nextCursor: null,
          total: 2,
        },
      },
    },
  ],
]);

const benchmarkPayload = {
  pages: {
    history: {
      items: Array.from({ length: 25 }, (_, index) =>
        position(
          `history-${String(index + 1).padStart(2, "0")}`,
          "closed",
          `H${String(index + 1).padStart(2, "0")}`,
        )
      ),
      nextCursor: null,
      total: 10_000,
    },
    open: {
      items: Array.from({ length: 25 }, (_, index) =>
        position(
          `open-${String(index + 1).padStart(2, "0")}`,
          "open",
          `O${String(index + 1).padStart(2, "0")}`,
        )
      ),
      nextCursor: null,
      total: 200,
    },
  },
};

window.__ad011BenchmarkPayloadBytes =
  new TextEncoder().encode(JSON.stringify(benchmarkPayload)).byteLength;
window.__ad011Requests = [];
window.fetch = async (input) => {
  const request = typeof input === "string"
    ? input
    : input instanceof URL
      ? input.toString()
      : input.url;
  window.__ad011Requests.push(request);
  const staleMode = new URL(window.location.href).searchParams.get("stale") ===
    "1";
  const benchmarkMode =
    new URL(window.location.href).searchParams.get("benchmark") === "1";

  if (benchmarkMode && request === "/api/account/positions") {
    return new Response(JSON.stringify(benchmarkPayload), {
      headers: { "content-type": "application/json" },
    });
  }

  if (
    staleMode &&
    request ===
      "/api/account/positions?scope=history&historyCursor=history-cursor"
  ) {
    return new Response(
      JSON.stringify({
        error: {
          code: "STALE_POSITION_CURSOR",
          message: "The position list changed.",
        },
      }),
      {
        headers: { "content-type": "application/json" },
        status: 409,
      },
    );
  }

  if (
    staleMode &&
    request === "/api/account/positions" &&
    window.__ad011Requests.filter((entry) =>
      entry === "/api/account/positions"
    ).length > 1
  ) {
    return new Response(
      JSON.stringify({
        pages: {
          history: {
            items: [
              position("history-1", "closed", "MSFT"),
              position("history-2", "expired", "TSLA"),
            ],
            nextCursor: null,
            total: 2,
          },
          open: {
            items: [position("open-1", "open", "AAPL")],
            nextCursor: "open-cursor",
            total: 2,
          },
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
  }

  const payload = responses.get(request);

  if (!payload) {
    return new Response(
      JSON.stringify({
        error: {
          code: "UNEXPECTED_FIXTURE_REQUEST",
          message: `Unexpected fixture request: ${request}`,
        },
      }),
      { status: 500 },
    );
  }

  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
};

const root = document.querySelector("#root");

if (!root) {
  throw new Error("AD-011 browser fixture root is missing.");
}

createRoot(root).render(<PaperPositionsPanel />);
