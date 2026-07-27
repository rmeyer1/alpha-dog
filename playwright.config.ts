import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/fixtures/finnhub-server.mjs",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      url: "http://127.0.0.1:3101/health",
    },
    {
      command: process.env.CI
        ? "npm run start -- --hostname 127.0.0.1 --port 3000"
        : "npm run dev -- --hostname 127.0.0.1 --port 3000",
      env: {
        ALPHA_DOG_DEPLOYMENT_MODE: "live",
        ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY: "",
        ALPHA_DOG_SUPABASE_URL: "",
        APCA_API_KEY_ID: "",
        APCA_API_SECRET_KEY: "",
        FINNHUB_API_BASE_URL: "http://127.0.0.1:3101/api/v1",
        FINNHUB_API_KEY: "playwright-test-key",
        NEXT_PUBLIC_ALPHA_DOG_SUPABASE_ANON_KEY: "",
        NEXT_PUBLIC_ALPHA_DOG_SUPABASE_URL: "",
        NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
        OPENAI_API_KEY: "",
        SIGNAL_SCRIBE_SUPABASE_SERVICE_ROLE_KEY:
          "playwright-signal-scribe-service-role",
        SIGNAL_SCRIBE_SUPABASE_URL: "http://127.0.0.1:3101",
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: "http://127.0.0.1:3000",
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
