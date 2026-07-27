import { expect, test } from "@playwright/test";

test("privacy and terms are globally discoverable from signed-out surfaces", async ({
  page,
}) => {
  for (const path of ["/", "/account"]) {
    await page.goto(path);
    const legalNavigation = page.getByRole("navigation", {
      name: "Legal and support",
    });

    await expect(legalNavigation.getByRole("link", { name: "Privacy" }))
      .toHaveAttribute("href", "/privacy");
    await expect(legalNavigation.getByRole("link", { name: "Terms" }))
      .toHaveAttribute("href", "/terms");
    await expect(legalNavigation.getByRole("link", { name: "Support" }))
      .toHaveAttribute(
        "href",
        "https://github.com/rmeyer1/alpha-dog/issues",
      );
  }
});

test("privacy notice discloses export, deletion, retention, and backups", async ({
  page,
}) => {
  await page.goto("/privacy");

  await expect(page.getByRole("heading", { name: "Privacy notice" }))
    .toBeVisible();
  await expect(page.getByText("Effective July 27, 2026")).toBeVisible();
  for (
    const heading of [
      "Data we store",
      "Providers and purposes",
      "Retention",
      "Export and deletion",
      "Backups and irreversibility",
      "Support",
    ]
  ) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }
  await expect(page.getByText(
    "Failed or unfinished statement imports: 30 days.",
  )).toBeVisible();
  await expect(page.getByText(
    "Permanent deletion requires a sign-in no more than ten minutes old",
    { exact: false },
  )).toBeVisible();
  await expect(page.getByText(
    "They are not available through the product",
    { exact: false },
  )).toBeVisible();
});

test("terms identify the product boundary and account termination path", async ({
  page,
}) => {
  await page.goto("/terms");

  await expect(page.getByRole("heading", { name: "Terms of use" }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Decision support only" }))
    .toBeVisible();
  await expect(page.getByText(
    "It is not a broker, investment adviser, tax adviser, or trade-execution service.",
  )).toBeVisible();
  await expect(page.getByRole("link", { name: "Privacy notice" }))
    .toHaveAttribute("href", "/privacy");
});
