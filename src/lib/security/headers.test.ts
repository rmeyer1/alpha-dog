import { describe, expect, it } from "vitest";
import {
  API_CONTENT_SECURITY_POLICY,
  buildPageContentSecurityPolicy,
  buildSecurityHeaders,
  parseContentSecurityPolicy,
  PERMISSIONS_POLICY,
  POLYMARKET_PROFILE_IMAGE_ORIGIN,
  TURNSTILE_ORIGIN,
} from "./headers";

describe("application security headers", () => {
  it("builds a strict production CSP from reviewed browser call sites", () => {
    const policy = buildPageContentSecurityPolicy({
      isDevelopment: false,
      nonce: "testNonce0123456789+/=",
    });
    const directives = parseContentSecurityPolicy(policy);

    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("script-src")).toEqual([
      "'self'",
      "'nonce-testNonce0123456789+/='",
      "'strict-dynamic'",
      TURNSTILE_ORIGIN,
    ]);
    expect(directives.get("script-src-attr")).toEqual(["'none'"]);
    expect(directives.get("style-src")).toEqual([
      "'self'",
      "'nonce-testNonce0123456789+/='",
    ]);
    expect(directives.get("style-src-attr")).toEqual(["'none'"]);
    expect(directives.get("connect-src")).toEqual([
      "'self'",
      TURNSTILE_ORIGIN,
    ]);
    expect(directives.get("frame-src")).toEqual([TURNSTILE_ORIGIN]);
    expect(directives.get("img-src")).toEqual([
      "'self'",
      POLYMARKET_PROFILE_IMAGE_ORIGIN,
    ]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("upgrade-insecure-requests")).toEqual([]);
    expect(policy).not.toContain("*");
    expect(policy).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("supabase.co");
    expect(policy).not.toContain("blob:");
    expect(policy).not.toContain("data:");
  });

  it("isolates development-only allowances from production", () => {
    const directives = parseContentSecurityPolicy(
      buildPageContentSecurityPolicy({
        isDevelopment: true,
        nonce: "developmentNonce",
      }),
    );

    expect(directives.get("script-src")).toContain("'unsafe-eval'");
    expect(directives.get("style-src")).toContain("'unsafe-inline'");
    expect(directives.get("style-src-attr")).toEqual(["'unsafe-inline'"]);
    expect(directives.get("connect-src")).toEqual([
      "'self'",
      TURNSTILE_ORIGIN,
      "ws:",
      "wss:",
    ]);
    expect(directives.has("upgrade-insecure-requests")).toBe(false);
  });

  it("rejects malformed nonces and duplicate directives", () => {
    expect(() =>
      buildPageContentSecurityPolicy({
        isDevelopment: false,
        nonce: "bad nonce;",
      })
    ).toThrow(/base64/);
    expect(() =>
      parseContentSecurityPolicy(
        "default-src 'self'; default-src https://example.com",
      )
    ).toThrow(/duplicate/);
  });

  it("emits the complete static header contract without overriding HSTS", () => {
    const entries = buildSecurityHeaders();
    const headers = new Map(
      entries.map((header) => [header.key, header.value]),
    );

    expect(entries).toHaveLength(headers.size);
    expect(headers.get("Content-Security-Policy")).toBe(
      API_CONTENT_SECURITY_POLICY,
    );
    expect(headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin-allow-popups",
    );
    expect(headers.get("Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(headers.get("Origin-Agent-Cluster")).toBe("?1");
    expect(headers.get("Permissions-Policy")).toBe(PERMISSIONS_POLICY);
    expect(headers.get("Permissions-Policy")).toContain("browsing-topics=()");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Permitted-Cross-Domain-Policies")).toBe("none");
    expect(headers.get("X-XSS-Protection")).toBe("0");
    expect(headers.has("Strict-Transport-Security")).toBe(false);
  });

  it("keeps non-document responses default-deny", () => {
    expect(parseContentSecurityPolicy(API_CONTENT_SECURITY_POLICY)).toEqual(
      new Map([
        ["default-src", ["'none'"]],
        ["base-uri", ["'none'"]],
        ["form-action", ["'none'"]],
        ["frame-ancestors", ["'none'"]],
        ["object-src", ["'none'"]],
      ]),
    );
  });
});
