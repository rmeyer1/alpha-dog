import { expect, test } from "@playwright/test";

test("invalid live configuration fails visibly and cannot return demo candidates", async ({
  page,
  request,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("deployment-status-banner")).toContainText(
    "Live data unavailable — configuration required",
  );
  await expect(page.getByTestId("desk-health-status")).toHaveText(
    "Configuration required",
  );

  const analysis = await request.post("/api/wheel/analyze", {
    data: {
      persona: "balanced_wheel",
      ticker: "AAPL",
    },
  });
  const payload = await analysis.json();

  expect(analysis.status()).toBe(503);
  expect(payload).toMatchObject({
    error: {
      code: "ALPACA_CREDENTIALS_NOT_CONFIGURED",
      retryable: false,
    },
  });

  await page.goto("/screeners");
  await expect(page.getByTestId("deployment-status-banner")).toContainText(
    "Live data unavailable — configuration required",
  );
  await expect(page.getByText("Demo data", { exact: true })).toHaveCount(0);
});
