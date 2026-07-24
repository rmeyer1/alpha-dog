import { readFile } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

let fixtureBundle = "";

test.beforeAll(async () => {
  const result = await build({
    bundle: true,
    banner: {
      js: "var process = { env: { NODE_ENV: \"production\" } };",
    },
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    entryPoints: [
      path.resolve("tests/e2e/fixtures/account-pagination.tsx"),
    ],
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    sourcemap: false,
    tsconfig: path.resolve("tsconfig.json"),
    write: false,
  });
  fixtureBundle = result.outputFiles[0]?.text ?? "";
  expect(fixtureBundle.length).toBeGreaterThan(0);
});

test("account positions paginate both tabs to terminal state without duplicates", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const fixtureHtml = await readFile(
    path.resolve("tests/e2e/fixtures/account-pagination.html"),
    "utf8",
  );
  await page.route("**/__ad011-account-pagination", async (route) => {
    await route.fulfill({
      body: fixtureHtml,
      contentType: "text/html",
    });
  });
  await page.goto("/__ad011-account-pagination");
  await page.addScriptTag({ content: fixtureBundle });
  expect(pageErrors).toEqual([]);

  await expect(page.getByRole("heading", {
    name: "Simulated position ledger",
  })).toBeVisible();
  await expect(page.getByText("AAPL")).toHaveCount(2);

  const openLoadMore = page.getByRole("button", {
    name: "Load more open positions",
  });
  await openLoadMore.focus();
  await openLoadMore.click();
  await expect(page.getByText("NVDA")).toHaveCount(2);
  const allOpen = page.getByRole("button", {
    name: "All open positions loaded",
  });
  await expect(allOpen).toHaveAttribute("aria-disabled", "true");
  await expect(allOpen).toBeFocused();

  await page.getByRole("button", { name: "History (2)" }).click();
  await expect(page.getByText("MSFT")).toHaveCount(2);
  const historyLoadMore = page.getByRole("button", {
    name: "Load more historical positions",
  });
  await historyLoadMore.focus();
  await historyLoadMore.click();
  await expect(page.getByText("TSLA")).toHaveCount(2);
  const allHistory = page.getByRole("button", {
    name: "All historical positions loaded",
  });
  await expect(allHistory).toHaveAttribute("aria-disabled", "true");
  await expect(allHistory).toBeFocused();

  await page.getByRole("button", { name: "Open (2)" }).click();
  await expect(page.getByText("AAPL")).toHaveCount(2);
  await expect(page.getByText("NVDA")).toHaveCount(2);
  await expect(page.getByText("MSFT")).toHaveCount(0);
  await expect(page.evaluate(() => window.__ad011Requests)).resolves.toEqual([
    "/api/account/positions",
    "/api/account/positions?scope=open&openCursor=open-cursor",
    "/api/account/positions?scope=history&historyCursor=history-cursor",
  ]);
});

test("a stale position cursor refreshes the first pages and preserves the tab", async ({
  page,
}) => {
  const fixtureHtml = await readFile(
    path.resolve("tests/e2e/fixtures/account-pagination.html"),
    "utf8",
  );
  await page.route("**/__ad011-account-pagination?stale=1", async (route) => {
    await route.fulfill({
      body: fixtureHtml,
      contentType: "text/html",
    });
  });
  await page.goto("/__ad011-account-pagination?stale=1");
  await page.addScriptTag({ content: fixtureBundle });

  await page.getByRole("button", { name: "History (2)" }).click();
  await page.getByRole("button", {
    name: "Load more historical positions",
  }).click();

  await expect(page.getByText("TSLA")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "History (2)" }))
    .toHaveClass(/bg-emerald-300/);
  await expect(page.getByRole("button", {
    name: "All historical positions loaded",
  })).toHaveAttribute("aria-disabled", "true");
  await expect(page.getByText(
    "Positions changed while paging, so the list was refreshed.",
  )).toHaveCount(1);
  await expect(page.evaluate(() => window.__ad011Requests)).resolves.toEqual([
    "/api/account/positions",
    "/api/account/positions?scope=history&historyCursor=history-cursor",
    "/api/account/positions",
  ]);
});

test("a large account keeps page payload and browser rendering bounded", async ({
  page,
}) => {
  const fixtureHtml = await readFile(
    path.resolve("tests/e2e/fixtures/account-pagination.html"),
    "utf8",
  );
  await page.route(
    "**/__ad011-account-pagination?benchmark=1",
    async (route) => {
      await route.fulfill({
        body: fixtureHtml,
        contentType: "text/html",
      });
    },
  );
  await page.goto("/__ad011-account-pagination?benchmark=1");
  await page.addScriptTag({ content: fixtureBundle });
  await expect(page.getByRole("button", { name: "Open (200)" }))
    .toBeVisible();

  const benchmark = await page.evaluate(async () => {
    const samples: number[] = [];

    for (let iteration = 0; iteration < 30; iteration += 1) {
      let refresh = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Refresh simulated positions"]',
      );

      while (!refresh) {
        await new Promise(requestAnimationFrame);
        refresh = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Refresh simulated positions"]',
        );
      }

      const requestCount = window.__ad011Requests.length;
      const startedAt = performance.now();
      refresh.click();

      while (window.__ad011Requests.length === requestCount) {
        await new Promise(requestAnimationFrame);
      }

      while (!document.querySelector(
        'button[aria-label="Refresh simulated positions"]',
      )) {
        await new Promise(requestAnimationFrame);
      }

      await new Promise(requestAnimationFrame);
      samples.push(performance.now() - startedAt);
    }

    samples.sort((left, right) => left - right);
    const percentile = (ratio: number) =>
      samples[Math.ceil(samples.length * ratio) - 1] ?? 0;

    return {
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
      payloadBytes: window.__ad011BenchmarkPayloadBytes,
      samples: samples.length,
    };
  });

  console.log(
    `AD-011 browser benchmark: ${benchmark.samples} samples, ` +
      `${benchmark.payloadBytes} payload bytes, ` +
      `${benchmark.medianMs.toFixed(2)} ms median, ` +
      `${benchmark.p95Ms.toFixed(2)} ms p95.`,
  );
  expect(benchmark.payloadBytes).toBeLessThan(100_000);
  expect(benchmark.p95Ms).toBeLessThan(500);
});
