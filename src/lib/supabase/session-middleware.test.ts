import { describe, expect, it } from "vitest";
import { shouldRefreshSession } from "./session-middleware";

describe("session middleware routing", () => {
  it("refreshes sessions for account pages and account-owned APIs", () => {
    expect(shouldRefreshSession("/account")).toBe(true);
    expect(shouldRefreshSession("/screeners")).toBe(true);
    expect(shouldRefreshSession("/api/presets")).toBe(true);
    expect(shouldRefreshSession("/api/auth/logout")).toBe(true);
  });

  it("does not intercept OAuth callback or OAuth start routes", () => {
    expect(shouldRefreshSession("/auth/callback")).toBe(false);
    expect(shouldRefreshSession("/api/auth/oauth/google")).toBe(false);
    expect(shouldRefreshSession("/api/auth/oauth/apple")).toBe(false);
  });

  it("does not intercept cron or static asset routes", () => {
    expect(shouldRefreshSession("/api/cron/wheel/screener-refresh")).toBe(false);
    expect(shouldRefreshSession("/_next/static/chunk.js")).toBe(false);
    expect(shouldRefreshSession("/favicon.ico")).toBe(false);
    expect(shouldRefreshSession("/images/logo.png")).toBe(false);
  });
});
