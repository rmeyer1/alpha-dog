import {
  // Next.js 16.2.11 documents the proxy name but still ships the legacy symbol.
  unstable_doesMiddlewareMatch as unstable_doesProxyMatch,
} from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function doesProxyMatch(url: string) {
  return unstable_doesProxyMatch({
    config,
    nextConfig: {},
    url,
  });
}

describe("Next.js proxy matcher", () => {
  it("forwards a fresh document nonce and returns the matching non-cacheable CSP", async () => {
    const first = await proxy(new NextRequest("https://alpha-dog.test/"));
    const second = await proxy(new NextRequest("https://alpha-dog.test/"));
    const firstPolicy = first.headers.get("content-security-policy") ?? "";
    const secondPolicy = second.headers.get("content-security-policy") ?? "";
    const firstNonce = firstPolicy.match(/'nonce-([^']+)'/)?.[1];
    const secondNonce = secondPolicy.match(/'nonce-([^']+)'/)?.[1];

    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(firstNonce);
    expect(
      first.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(firstPolicy);
  });

  it("preserves API session refresh responses without a document nonce", async () => {
    const response = await proxy(
      new NextRequest("https://alpha-dog.test/api/auth/logout"),
    );

    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBeNull();
  });

  it.each([
    "/",
    "/screeners",
    "/traders",
    "/company/AAPL",
    "/company/BRK.B",
    "/company/BRK.B?source=matcher",
    "/research.v2/company/BRK.B",
    "/research/company/BRK.B.json",
    "/auth/callback",
    "/account",
    "/account/",
    "/account?source=header",
    "/account/manual",
    "/privacy",
    "/terms",
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
    "/api/logos/AAPL",
    "/api/logos/AAPL?size=64",
    "/api/wheel/screener",
    "/api/finnhub/company/AAPL",
    "/api/polymarket/leaderboard",
    "/api/health/configuration",
    "/api/auth/manual-account",
    "/api/auth/oauth/google",
    "/api/auth/profile/extra",
    "/api/auth/logout/extra",
    "/api/auth/account-state/extra",
    "/api/accounts",
    "/api/preset",
    "/api/cron/wheel/screener-refresh",
    "/_next/static/chunk.js",
    "/_next/static/chunk.js?v=1",
    "/_next/image?url=%2Flogo.png&w=64&q=75",
    "/robots.txt",
    "/robots.txt?cache=miss",
    "/sitemap.xml",
    "/manifest.webmanifest",
    "/images/logo.png",
    "/images/logo.png?v=1",
    "/favicon.ico",
  ])("does not match the public or self-authenticating surface %s", (url) => {
    expect(doesProxyMatch(url)).toBe(false);
  });
});
