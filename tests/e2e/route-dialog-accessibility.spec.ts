import { readFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { build } from "esbuild";
import { expect, type Locator, type Page, test } from "@playwright/test";

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
      path.resolve("tests/e2e/fixtures/ad015-overlays.tsx"),
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

async function mountOverlayFixture(page: Page) {
  await page.goto("/");
  const stylesheetUrls = await page
    .locator('link[rel="stylesheet"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).href));
  const fixtureHtml = await readFile(
    path.resolve("tests/e2e/fixtures/ad015-overlays.html"),
    "utf8",
  );

  await page.route("**/__ad015-overlays", async (route) => {
    await route.fulfill({
      body: fixtureHtml,
      contentType: "text/html",
    });
  });
  await page.goto("/__ad015-overlays");

  for (const url of stylesheetUrls) {
    await page.addStyleTag({ url });
  }

  await page.addScriptTag({ content: fixtureBundle });
  await expect(page.getByRole("heading", {
    name: "AD-015 overlay verification",
  })).toBeVisible();
}

async function expectNoSeriousAxeViolations(
  page: Page,
  include?: string,
) {
  let builder = new AxeBuilder({ page });

  if (include) {
    builder = builder.include(include);
  }

  const results = await builder.analyze();
  const violations = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );

  expect(
    violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target),
    })),
  ).toEqual([]);
}

function visibleFocusables(dialog: Locator) {
  return dialog.locator([
    "a[href]:visible",
    "button:not([disabled]):not([tabindex='-1']):visible",
    "input:not([disabled]):visible",
    "select:not([disabled]):visible",
    "textarea:not([disabled]):visible",
    "[tabindex]:not([tabindex='-1']):visible",
  ].join(","));
}

async function expectDialogIsolation(
  page: Page,
  label: string,
  runAxe = true,
) {
  const dialog = page.getByRole("dialog", { name: label });

  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-describedby", /.+/);
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect.poll(() =>
    page.locator("#root").evaluate((root) => (root as HTMLElement).inert)
  ).toBe(true);
  await expect.poll(() =>
    dialog.evaluate((element) => element.contains(document.activeElement))
  ).toBe(true);
  if (runAxe) {
    await expectNoSeriousAxeViolations(
      page,
      `[role="dialog"][aria-label="${label}"]`,
    );
  }

  return dialog;
}

async function expectFocusTrap(page: Page, dialog: Locator) {
  const focusables = visibleFocusables(dialog);
  const first = focusables.first();
  const last = focusables.last();

  await expect(first).toBeVisible();
  await expect(last).toBeVisible();
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await first.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(last).toBeFocused();
}

test("candidate, spread, open-position, wallet, and filing overlays contain keyboard focus", async ({
  page,
}) => {
  await mountOverlayFixture(page);

  const cases = [
    {
      dialog: "Contract ranking details",
      trigger: "Open candidate details",
    },
    {
      dialog: "Credit spread details",
      trigger: "Open spread details",
    },
    {
      dialog: "Open simulated position",
      initialFocus: "Strategy type",
      trigger: "Open position form",
    },
    {
      dialog: "Wallet profile",
      trigger: "Open wallet profile",
    },
    {
      dialog: "Filing analysis details",
      trigger: "Review full analysis",
    },
  ];

  for (const overlayCase of cases) {
    const trigger = page.getByRole("button", { name: overlayCase.trigger });

    await trigger.focus();
    await trigger.click();
    const dialog = await expectDialogIsolation(page, overlayCase.dialog);

    if (overlayCase.initialFocus) {
      await expect(page.getByLabel(overlayCase.initialFocus)).toBeFocused();
    }

    await expectFocusTrap(page, dialog);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect.poll(() =>
      page.locator("#root").evaluate((root) => (root as HTMLElement).inert)
    ).toBe(false);
  }
});

test("position detail and close-position overlays preserve a safe stacked focus path", async ({
  page,
}) => {
  await mountOverlayFixture(page);
  const positionTrigger = page.getByRole("button", { name: /AAPL/ });

  await expect(positionTrigger).toBeVisible();
  await positionTrigger.focus();
  await positionTrigger.click();
  const detailDialog = await expectDialogIsolation(
    page,
    "Simulated position detail",
  );
  await expectFocusTrap(page, detailDialog);

  const closePositionTrigger = detailDialog.getByRole("button", {
    name: "Close position",
    exact: true,
  });

  await closePositionTrigger.focus();
  await closePositionTrigger.click();
  const closeDialog = await expectDialogIsolation(
    page,
    "Close simulated position",
  );

  await expect(page.getByLabel("Contracts")).toBeFocused();
  await expect.poll(() =>
    page.locator("[role='dialog']").evaluateAll((dialogs) =>
      dialogs.map((dialog) => ({
        inert: (dialog as HTMLElement).inert,
        label: dialog.getAttribute("aria-label"),
        zIndex: getComputedStyle(dialog).zIndex,
      })))
  ).toEqual([
    { inert: true, label: "Simulated position detail", zIndex: "50" },
    { inert: false, label: "Close simulated position", zIndex: "60" },
  ]);
  await expectFocusTrap(page, closeDialog);

  await page.keyboard.press("Escape");
  await expect(closeDialog).toHaveCount(0);
  await expect(detailDialog).toBeVisible();
  await expect(closePositionTrigger).toBeFocused();
  await expect.poll(() =>
    detailDialog.evaluate((element) => (element as HTMLElement).inert)
  ).toBe(false);

  await page.keyboard.press("Escape");
  await expect(detailDialog).toHaveCount(0);
  await expect(positionTrigger).toBeFocused();
});

test("overlays remain operable across responsive, zoomed, reduced-motion, and forced-colors modes", async ({
  page,
}) => {
  for (
    const viewport of [
      { height: 844, width: 390 },
      { height: 1024, width: 768 },
      { height: 900, width: 1440 },
    ]
  ) {
    await page.setViewportSize(viewport);
    await mountOverlayFixture(page);
    await page.getByRole("button", { name: "Open candidate details" }).click();
    const dialog = await expectDialogIsolation(
      page,
      "Contract ranking details",
    );
    const bounds = await dialog.boundingBox();

    expect(bounds).not.toBeNull();
    expect((bounds?.width ?? 0) <= viewport.width).toBe(true);
    expect((bounds?.height ?? 0) <= viewport.height).toBe(true);
    await page.keyboard.press("Escape");
  }

  await page.setViewportSize({ height: 900, width: 1440 });
  await mountOverlayFixture(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await page.getByRole("button", { name: "Open candidate details" }).click();
  await expect(page.getByRole("dialog", {
    name: "Contract ranking details",
  })).toBeVisible();
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  )).toBe(true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.documentElement.style.zoom = "1";
  });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => page.evaluate(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )).toBe(true);
  await expect.poll(() =>
    page.getByRole("button", { name: "Open wallet profile" }).evaluate(
      (button) => Number.parseFloat(
        getComputedStyle(button).transitionDuration,
      ),
    )
  ).toBeLessThanOrEqual(0.001);

  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "Open wallet profile" }).click();
  const walletDialog = await expectDialogIsolation(
    page,
    "Wallet profile",
    false,
  );

  await expect(walletDialog.getByRole("button", {
    name: "Close wallet profile",
  })).toBeVisible();
  const closeWalletButton = walletDialog.getByRole("button", {
    name: "Close wallet profile",
  });
  await page.keyboard.press("Tab");
  await expect(closeWalletButton).toBeFocused();
  await expect.poll(() =>
    closeWalletButton.evaluate((button) => getComputedStyle(button).outlineStyle)
  ).not.toBe("none");
  await page.keyboard.press("Escape");
});

test("primary routes and intentional not-found states have no serious automated accessibility violations", async ({
  page,
}) => {
  await page.route("**/api/auth/account-state", async (route) => {
    await route.fulfill({
      body: JSON.stringify({ account: { status: "unauthenticated" } }),
      contentType: "application/json",
    });
  });
  await page.route("**/api/presets", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        error: { code: "UNAUTHENTICATED", message: "Sign in." },
      }),
      contentType: "application/json",
      status: 401,
    });
  });
  await page.route("**/api/wheel/screener", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        companies: [],
        dataFreshness: {
          asOf: "2026-07-23T18:00:00.000Z",
          cacheStatus: "demo",
          feed: "demo",
          nextSuggestedRefreshAt: null,
          source: "demo",
        },
        errors: [],
        persona: {
          id: "balanced_wheel",
          motto: "Balanced risk and income.",
          name: "Balanced Wheel",
        },
        progress: { completed: 0, failed: 0, total: 0 },
        screenedCount: 0,
        skippedCount: 0,
        warnings: [],
      }),
      contentType: "application/json",
    });
  });
  await page.route("**/api/polymarket/leaderboard?*", async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        dataFreshness: {
          asOf: "2026-07-23T18:00:00.000Z",
          cacheStatus: "demo",
          cachedUntil: null,
          source: "demo",
        },
        traders: [],
      }),
      contentType: "application/json",
    });
  });

  for (
    const pathName of [
      "/",
      "/screeners",
      "/traders",
      "/account",
      "/company/BRK.B",
    ]
  ) {
    await page.goto(pathName);
    await expect(page.locator("main[aria-busy='true']")).toHaveCount(0);
    await expect(page.locator("main").last()).toBeVisible();
    await expectNoSeriousAxeViolations(page);
  }

  await page.goto("/route-that-does-not-exist");
  await expect(page.getByRole("heading", {
    name: "We could not find that page",
  })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.goto("/company/INVALID_SYMBOL");
  await expect(page.getByRole("heading", {
    name: "Company symbol not found",
  })).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.goto("/company/ZZZZ");
  await expect(page.getByRole("heading", {
    name: "Company symbol not found",
  })).toBeVisible();
  await expectNoSeriousAxeViolations(page);
});
