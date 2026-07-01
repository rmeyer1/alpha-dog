import { expect, type Page, test } from "@playwright/test";

const baseFilters = {
  dteMin: 21,
  dteMax: 30,
  deltaMin: 0.15,
  deltaMax: 0.3,
  minPremiumYield: 0.01,
  minVolume: 100,
  minOpenInterest: 100,
  maxSpreadPctOfMid: 0.25,
  minSpreadReturnOnRisk: 0.2,
  maxSpreadWidth: 5,
  spreadLongLegCount: 1,
  excludeEarnings: true,
  includeWeeklies: false,
};

async function mockAccountState(page: Page, account: unknown) {
  await page.route("**/api/auth/account-state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ account }),
    });
  });
}

async function mockScreener(page: Page) {
  await page.route("**/api/wheel/screener", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        persona: {
          id: "balanced_wheel",
          name: "Balanced Wheel",
          motto: "Balanced risk and income.",
        },
        dataFreshness: {
          feed: "demo",
          cacheStatus: "demo",
          asOf: "2026-07-01T00:00:00.000Z",
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
        warnings: [],
        errors: [],
      }),
    });
  });
}

async function mockPresets(
  page: Page,
  status: number,
  payload: unknown,
) {
  await page.route("**/api/presets", async (route) => {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(payload),
    });
  });
}

async function mockPresetAccessError(
  page: Page,
  code: string,
  message: string,
  status = 403,
) {
  await mockPresets(page, status, {
    error: {
      code,
      message,
    },
  });
}

test("account page exposes signed-out auth actions and accessible manual form fields", async ({ page }) => {
  await mockAccountState(page, { status: "unauthenticated" });

  await page.goto("/account?auth_error=oauth_cancelled&next=/screeners");

  await expect(page.getByRole("heading", {
    name: "Sign in to manage your account",
  })).toBeVisible();
  await expect(page.getByText("Sign-in cancelled")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in with Google" }))
    .toBeVisible();
  await expect(page.getByRole("link", { name: "Create a manual account" }))
    .toBeVisible();
  await expect(page.getByLabel("First name")).toBeVisible();
  await expect(page.getByLabel("Last name")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("account page shows profile-required callback notice", async ({ page }) => {
  await mockAccountState(page, { status: "unauthenticated" });

  await page.goto("/account?profile=complete&next=/screeners");

  await expect(page.getByText("Profile completion required")).toBeVisible();
  await expect(page.getByRole("link", { name: "Retry Google" }))
    .toHaveAttribute("href", "/api/auth/oauth/google?next=%2Fscreeners");
  await expect(page.getByRole("link", { name: "Dashboard" }))
    .toHaveAttribute("href", "/screeners");
});

test("manual account form handles validation, server errors, and success announcements", async ({ page }) => {
  await mockAccountState(page, { status: "unauthenticated" });
  let manualAccountRequests = 0;

  await page.route("**/api/auth/manual-account", async (route) => {
    manualAccountRequests += 1;
    const body = manualAccountRequests === 1
      ? {
          error: {
            code: "VALIDATION_FAILED",
            details: {
              fieldErrors: {
                email: ["Use a work email address."],
              },
            },
            message: "Manual account validation failed.",
          },
        }
      : {
          account: {
            email: "desk@example.com",
          },
          status: "invite_sent",
        };

    await route.fulfill({
      status: manualAccountRequests === 1 ? 400 : 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });

  await page.goto("/account?next=/screeners");

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Please fill out this field.")).toHaveCount(0);
  expect(manualAccountRequests).toBe(0);

  await page.getByLabel("First name").fill("Ryan");
  await page.getByLabel("Last name").fill("Meyer");
  await page.getByLabel("Email").fill("desk@example.com");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Use a work email address.")).toBeVisible();

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Invite sent to desk@example.com. Check your email to continue."))
    .toBeVisible();
});

test("account navigation exposes loading and error states", async ({ page }) => {
  let releaseAccountState: (() => void) | null = null;
  const pendingAccountState = new Promise<void>((resolve) => {
    releaseAccountState = resolve;
  });

  await page.route("**/api/auth/account-state", async (route) => {
    await pendingAccountState;
    await route.abort();
  });
  await mockPresetAccessError(
    page,
    "UNAUTHENTICATED",
    "Sign in to use saved presets.",
    401,
  );
  await mockScreener(page);

  await page.goto("/screeners");

  await expect(page.getByText("Account").first()).toBeVisible();
  releaseAccountState?.();
  await expect(page.getByRole("link", { name: "Account unavailable" }))
    .toBeVisible();
});

test("presets panel gates save and delete controls for signed-out users", async ({ page }) => {
  await mockAccountState(page, { status: "unauthenticated" });
  await mockPresets(page, 401, {
    error: {
      code: "UNAUTHENTICATED",
      message: "Sign in to use saved presets.",
    },
  });
  await mockScreener(page);

  await page.goto("/screeners");

  await expect(page.getByRole("heading", { name: "Saved Presets" }))
    .toBeVisible();
  await expect(page.getByText("Sign in to save presets")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first())
    .toBeVisible();
  await expect(page.getByRole("button", { name: "Save Current Filters" }))
    .toHaveCount(0);
});

test("presets panel gates save controls for incomplete profiles", async ({ page }) => {
  await mockAccountState(page, {
    status: "incomplete_profile",
    email: "desk@example.com",
    missingFields: ["last name"],
  });
  await mockPresetAccessError(
    page,
    "PROFILE_INCOMPLETE",
    "Complete your account profile to use saved presets.",
  );
  await mockScreener(page);

  await page.goto("/screeners");

  await expect(page.getByText("Complete profile to save presets")).toBeVisible();
  await expect(page.getByRole("link", {
    exact: true,
    name: "Complete profile",
  })).toHaveAttribute("href", "/account?next=/screeners");
  await expect(page.getByRole("button", { name: "Save Current Filters" }))
    .toHaveCount(0);
});

test("authenticated presets can be saved and deleted", async ({ page }) => {
  await mockAccountState(page, {
    status: "ready",
    displayName: "Ryan Meyer",
    email: "desk@example.com",
  });
  await mockScreener(page);

  let presets = [
    {
      id: "preset-1",
      name: "Desk preset",
      basePersona: "balanced_wheel",
      filters: baseFilters,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    },
  ];

  await page.route("**/api/presets", async (route) => {
    if (route.request().method() === "POST") {
      presets = [
        ...presets,
        {
          ...presets[0],
          id: "preset-2",
          name: "Balanced 21-30 DTE",
        },
      ];
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ preset: presets[1] }),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ presets }),
    });
  });
  await page.route("**/api/presets/preset-1", async (route) => {
    presets = presets.filter((preset) => preset.id !== "preset-1");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "deleted" }),
    });
  });

  await page.goto("/screeners");

  await expect(page.getByText("Desk preset")).toBeVisible();
  await expect(page.getByLabel("Preset name")).toBeVisible();
  await page.getByRole("button", { name: "Save Current Filters" }).click();
  await expect(page.getByText("Preset saved.")).toBeVisible();
  await expect(page.getByText("Balanced 21-30 DTE")).toBeVisible();

  await page.getByRole("button", { name: "Delete Desk preset" }).click();
  await expect(page.getByText("Preset deleted.")).toBeVisible();
  await expect(page.getByText("Desk preset")).toHaveCount(0);
});

test("dashboard logout clears account-owned preset UI state", async ({ page }) => {
  await mockAccountState(page, {
    status: "ready",
    displayName: "Ryan Meyer",
    email: "desk@example.com",
  });
  await mockPresets(page, 200, {
    presets: [
      {
        id: "preset-1",
        name: "Desk preset",
        basePersona: "balanced_wheel",
        filters: baseFilters,
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  });
  await mockScreener(page);
  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "signed_out" }),
    });
  });

  await page.goto("/screeners");

  await expect(page.getByText("Ryan Meyer")).toBeVisible();
  await expect(page.getByText("Desk preset")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Signed out.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in" }).first())
    .toBeVisible();
  await expect(page.getByText("Sign in to save presets")).toBeVisible();
  await expect(page.getByText("Desk preset")).toHaveCount(0);
});

test("account navigation flags incomplete profiles", async ({ page }) => {
  await mockAccountState(page, {
    status: "incomplete_profile",
    email: "desk@example.com",
    missingFields: ["last name"],
  });

  await page.goto("/");

  await expect(page.getByText("desk@example.com").first()).toBeVisible();
  await expect(page.getByText("Complete profile")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
