import { expect, type Page, test } from "@playwright/test";

const walletOne = "0x1111111111111111111111111111111111111111";
const walletTwo = "0x2222222222222222222222222222222222222222";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });

  return { promise, resolve };
}

function freshness() {
  return {
    asOf: "2026-07-23T18:00:00.000Z",
    cacheStatus: "demo",
    cachedUntil: null,
    source: "demo",
  };
}

function screenerResponse(filters: Record<string, unknown>) {
  return {
    persona: {
      id: "balanced_wheel",
      name: "Balanced Wheel",
      motto: "Balanced risk and income.",
    },
    dataFreshness: {
      ...freshness(),
      feed: "demo",
      nextSuggestedRefreshAt: null,
    },
    companies: [],
    screenedCount: 0,
    skippedCount: 0,
    progress: {
      total: 0,
      completed: 0,
      failed: 0,
    },
    filters,
    warnings: [],
    errors: [],
  };
}

function analysisResponse(ticker: string) {
  return {
    ticker,
    underlying: {
      symbol: ticker,
      price: 100,
      asOf: "2026-07-23T18:00:00.000Z",
      trend: "bullish",
      rsi14: 55,
      movingAverages: {
        ma20: 98,
        ma50: 95,
        ma200: 90,
      },
    },
    persona: {
      id: "balanced_wheel",
      name: "Balanced Wheel",
      motto: "Balanced risk and income.",
    },
    dataFreshness: {
      ...freshness(),
      feed: "demo",
      nextSuggestedRefreshAt: null,
    },
    shortPuts: [],
    coveredCalls: [],
    putCreditSpreads: [],
    callCreditSpreads: [],
    warnings: [],
    errors: [],
  };
}

async function mockSharedDashboardRequests(page: Page) {
  await page.route("**/api/auth/account-state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ account: { status: "unauthenticated" } }),
    });
  });
  await page.route("**/api/presets", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "UNAUTHENTICATED",
          message: "Sign in to use saved presets.",
        },
      }),
    });
  });
}

test("Wheel applies rapid edits once and restores applied state through history and reload", async ({
  page,
}) => {
  await mockSharedDashboardRequests(page);
  const secondRequest = deferred();
  let requestCount = 0;

  await page.route("**/api/wheel/screener", async (route) => {
    requestCount += 1;
    const requestBody = route.request().postDataJSON() as {
      filters: Record<string, unknown>;
    };

    if (requestCount === 2) {
      await secondRequest.promise;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(screenerResponse(requestBody.filters)),
    }).catch(() => undefined);
  });

  await page.goto("/screeners");
  await expect(page.getByText(/Results generated with/)).toBeVisible();
  await expect(page.getByText("DTE 21-30", { exact: true }).first())
    .toBeVisible();
  await expect.poll(() => requestCount).toBe(1);

  const dteMin = page.getByLabel("DTE min slider");
  await dteMin.fill("7");
  await dteMin.fill("8");
  await dteMin.fill("9");
  await expect(page.getByText("Draft changes are not applied to the visible results yet."))
    .toBeVisible();
  await expect.poll(() => requestCount).toBe(1);

  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect.poll(() => requestCount).toBe(2);
  await expect(page.getByText("DTE 21-30", { exact: true }).first())
    .toBeVisible();
  secondRequest.resolve();
  await expect(page.getByText("DTE 9-30", { exact: true }).first())
    .toBeVisible();
  await expect(page).toHaveURL(/f_dteMin=9/);

  await dteMin.fill("10");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByText("DTE 10-30", { exact: true }).first())
    .toBeVisible();
  await expect(page).toHaveURL(/f_dteMin=10/);

  await page.goBack();
  await expect(page).toHaveURL(/f_dteMin=9/);
  await expect(page.getByText("DTE 9-30", { exact: true }).first())
    .toBeVisible();

  await page.goForward();
  await expect(page).toHaveURL(/f_dteMin=10/);
  await expect(page.getByText("DTE 10-30", { exact: true }).first())
    .toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/f_dteMin=9/);
  await page.reload();
  await expect(page.getByLabel("DTE min slider")).toHaveValue("9");
  await expect(page.getByText("DTE 9-30", { exact: true }).first())
    .toBeVisible();
});

test("Wheel submits the first typed ticker for analysis", async ({ page }) => {
  await mockSharedDashboardRequests(page);
  let analyzedTicker: string | null = null;

  await page.route("**/api/wheel/screener", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      filters: Record<string, unknown>;
    };

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(screenerResponse(requestBody.filters)),
    });
  });
  await page.route("**/api/wheel/analyze", async (route) => {
    const requestBody = route.request().postDataJSON() as {
      ticker: string;
    };
    analyzedTicker = requestBody.ticker;

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(analysisResponse(requestBody.ticker)),
    });
  });

  await page.goto("/screeners");
  const analyzeButton = page.getByRole("button", {
    name: "Analyze",
    exact: true,
  });
  await expect(analyzeButton).toBeDisabled();

  await page.getByLabel("Ticker symbol").fill("AAPL");
  await expect(analyzeButton).toBeEnabled();
  await analyzeButton.click();

  await expect.poll(() => analyzedTicker).toBe("AAPL");
  await expect(page).toHaveURL(/ticker=AAPL/);
  await expect(page.getByText(/Balanced Wheel · AAPL · DTE 21-30/))
    .toBeVisible();
});

test("Trader tab changes abort stale work and refresh preserves the usable result", async ({
  page,
}) => {
  const leaderboardRequest = deferred();
  const whaleRequest = deferred();
  const sharpRefresh = deferred();
  let leaderboardCalls = 0;
  let whaleCalls = 0;
  let sharpCalls = 0;

  await page.route("**/api/polymarket/leaderboard?*", async (route) => {
    leaderboardCalls += 1;
    await leaderboardRequest.promise;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ dataFreshness: freshness(), traders: [] }),
    }).catch(() => undefined);
  });
  await page.route("**/api/polymarket/whales?*", async (route) => {
    whaleCalls += 1;
    await whaleRequest.promise;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        criteria: {
          category: "OVERALL",
          minValue: 10000,
          orderBy: "PNL",
          timePeriod: "WEEK",
        },
        dataFreshness: freshness(),
        whales: [],
      }),
    }).catch(() => undefined);
  });
  await page.route("**/api/polymarket/sharp-plays?*", async (route) => {
    sharpCalls += 1;
    if (sharpCalls === 2) {
      await sharpRefresh.promise;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        criteria: {
          category: "OVERALL",
          minTraders: 3,
          orderBy: "PNL",
          timePeriod: "WEEK",
        },
        dataFreshness: freshness(),
        plays: [],
      }),
    }).catch(() => undefined);
  });

  await page.goto("/traders");
  await expect.poll(() => leaderboardCalls).toBe(1);
  await page.getByRole("button", { name: "Whales" }).click();
  await expect.poll(() => whaleCalls).toBe(1);
  await page.getByRole("button", { name: "Sharp Plays" }).click();
  await expect.poll(() => sharpCalls).toBe(1);
  await expect(page.getByText("Generated with OVERALL · WEEK · PNL · 25 rows"))
    .toBeVisible();
  await expect(page).toHaveURL(/tab=sharp/);

  leaderboardRequest.resolve();
  whaleRequest.resolve();
  await expect(page.getByText("Sharp Plays", { exact: true }).last())
    .toBeVisible();
  await expect(page.getByText(/Unable to load/)).toHaveCount(0);

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect.poll(() => sharpCalls).toBe(2);
  await expect(page.getByText("Generated with OVERALL · WEEK · PNL · 25 rows"))
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  sharpRefresh.resolve();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("Wallet URL restoration supersedes an active wallet-detail request", async ({
  page,
}) => {
  const firstWalletRequest = deferred();
  let walletCalls = 0;

  await page.route("**/api/polymarket/traders/0x*", async (route) => {
    walletCalls += 1;
    const wallet = decodeURIComponent(
      new URL(route.request().url()).pathname.split("/").at(-1) ?? "",
    );

    if (wallet === walletOne) {
      await firstWalletRequest.promise;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        activity: [],
        closedPositions: [],
        dataFreshness: freshness(),
        openPositions: [],
        scores: {
          activityScore: 0,
          alphaDogScore: 50,
          edgeScore: 0,
          profitabilityScore: 0,
        },
        summary: {
          closedPositionCount: 0,
          concentrationRatio: 0,
          lastActivityAt: null,
          openCashPnl: 0,
          openPositionCount: 0,
          positiveClosedPositionRate: null,
          realizedPnl: 0,
          recentActivityCount: 0,
          topMarketValue: 0,
          totalOpenValue: 0,
        },
        totalValue: 0,
        wallet,
      }),
    }).catch(() => undefined);
  });

  await page.goto(`/traders?tab=lookup&wallet=${walletOne}`);
  await expect(page.getByLabel("Wallet Address")).toHaveValue(walletOne);
  await expect.poll(() => walletCalls).toBe(1);

  await page.getByRole("button", { name: "Close" }).click();
  await page.getByLabel("Wallet Address").fill(walletTwo);
  await page.getByRole("button", { name: "Analyze Wallet" }).click();
  await expect.poll(() => walletCalls).toBe(2);
  await expect(page).toHaveURL(new RegExp(`wallet=${walletTwo}`));
  await expect(page.getByText(walletTwo).first()).toBeVisible();

  firstWalletRequest.resolve();
  await expect(page.getByText(walletOne)).toHaveCount(0);
  await expect(page.getByText("Unable to load wallet profile.")).toHaveCount(0);
});

test("Wallet Lookup releases an in-flight leaderboard loading state", async ({
  page,
}) => {
  const leaderboardRequest = deferred();

  await page.route("**/api/polymarket/leaderboard?*", async (route) => {
    await leaderboardRequest.promise;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ dataFreshness: freshness(), traders: [] }),
    }).catch(() => undefined);
  });
  await page.route(`**/api/polymarket/traders/${walletOne}`, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        activity: [],
        closedPositions: [],
        dataFreshness: freshness(),
        openPositions: [],
        scores: {
          activityScore: 0,
          alphaDogScore: 50,
          edgeScore: 0,
          profitabilityScore: 0,
        },
        summary: {
          closedPositionCount: 0,
          concentrationRatio: 0,
          lastActivityAt: null,
          openCashPnl: 0,
          openPositionCount: 0,
          positiveClosedPositionRate: null,
          realizedPnl: 0,
          recentActivityCount: 0,
          topMarketValue: 0,
          totalOpenValue: 0,
        },
        totalValue: 0,
        wallet: walletOne,
      }),
    });
  });

  await page.goto("/traders");
  await page.getByRole("button", { name: "Wallet Lookup" }).click();
  await page.getByLabel("Wallet Address").fill(walletOne);
  await page.getByRole("button", { name: "Analyze Wallet" }).click();

  await expect(page.getByText(walletOne).first()).toBeVisible();
  await expect(
    page.locator("main button").filter({ hasText: "Refresh" }).first(),
  ).toBeEnabled();
  await expect(page.getByText(/Unable to load/)).toHaveCount(0);

  leaderboardRequest.resolve();
});
