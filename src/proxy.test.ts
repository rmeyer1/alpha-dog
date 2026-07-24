import {
  // Next.js 16.2.11 documents the proxy name but still ships the legacy symbol.
  unstable_doesMiddlewareMatch as unstable_doesProxyMatch,
} from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";
import { config } from "./proxy";

function doesProxyMatch(url: string) {
  return unstable_doesProxyMatch({
    config,
    nextConfig: {},
    url,
  });
}

describe("Next.js proxy matcher", () => {
  it.each([
    "/account",
    "/account/",
    "/account?source=header",
    "/account/manual",
    "/api/account/positions",
    "/api/account/positions?status=open",
    "/api/account/statement-import/import-1",
    "/api/presets",
    "/api/presets/",
    "/api/presets/preset-1",
    "/api/auth/account-state",
    "/api/auth/logout",
    "/api/auth/profile",
    "/api/auth/profile/",
    "/api/auth/profile?source=account",
  ])("matches the account surface %s", (url) => {
    expect(doesProxyMatch(url)).toBe(true);
  });

  it.each([
    "/",
    "/screeners",
    "/traders",
    "/company/AAPL",
    "/api/logos/AAPL",
    "/api/wheel/screener",
    "/api/finnhub/company/AAPL",
    "/api/polymarket/leaderboard",
    "/api/health/configuration",
    "/api/auth/manual-account",
    "/api/auth/oauth/google",
    "/api/auth/profile/extra",
    "/api/auth/logout/extra",
    "/api/auth/account-state/extra",
    "/accountant",
    "/api/accounts",
    "/api/preset",
    "/auth/callback",
    "/api/cron/wheel/screener-refresh",
    "/_next/static/chunk.js",
    "/_next/image?url=%2Flogo.png&w=64&q=75",
    "/robots.txt",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/images/logo.png",
    "/favicon.ico",
  ])("does not match the public or self-authenticating surface %s", (url) => {
    expect(doesProxyMatch(url)).toBe(false);
  });
});
