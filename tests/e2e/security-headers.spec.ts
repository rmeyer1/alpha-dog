import { expect, test } from "@playwright/test";

const turnstileOrigin = "https://challenges.cloudflare.com";
const profileImageOrigin =
  "https://polymarket-upload.s3.us-east-2.amazonaws.com";
const requiredHeaders = {
  "cross-origin-opener-policy": "same-origin-allow-popups",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
};

function parseCsp(policy: string) {
  const directives = new Map<string, string[]>();

  expect(policy).not.toContain(",");

  for (const rawDirective of policy.split(";")) {
    const normalized = rawDirective.trim();

    if (!normalized) {
      continue;
    }

    const [name, ...values] = normalized.split(/\s+/);

    expect(directives.has(name), `duplicate CSP directive ${name}`).toBe(false);
    directives.set(name, values);
  }

  return directives;
}

function expectCommonHeaders(headers: Record<string, string>) {
  for (const [name, value] of Object.entries(requiredHeaders)) {
    expect(headers[name], name).toBe(value);
  }

  for (
    const feature of [
      "browsing-topics=()",
      "camera=()",
      "geolocation=()",
      "microphone=()",
      "payment=()",
      "usb=()",
    ]
  ) {
    expect(headers["permissions-policy"]).toContain(feature);
  }

  expect(headers["strict-transport-security"]).toBeUndefined();
  expect(headers["x-powered-by"]).toBeUndefined();
}

function expectDocumentCsp(policy: string) {
  const directives = parseCsp(policy);
  const nonce = directives.get("script-src")?.find((value) =>
    /^'nonce-[A-Za-z0-9+/_=-]+'$/.test(value)
  );

  expect(nonce).toBeTruthy();
  expect(directives.get("default-src")).toEqual(["'self'"]);
  expect(directives.get("script-src")).toEqual([
    "'self'",
    nonce,
    "'strict-dynamic'",
    turnstileOrigin,
  ]);
  expect(directives.get("script-src-attr")).toEqual(["'none'"]);
  expect(directives.get("style-src")).toEqual(["'self'", nonce]);
  expect(directives.get("style-src-attr")).toEqual(["'none'"]);
  expect(directives.get("connect-src")).toEqual([
    "'self'",
    turnstileOrigin,
  ]);
  expect(directives.get("img-src")).toEqual([
    "'self'",
    profileImageOrigin,
  ]);
  expect(directives.get("frame-src")).toEqual([turnstileOrigin]);
  expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
  expect(directives.get("form-action")).toEqual(["'self'"]);
  expect(directives.get("object-src")).toEqual(["'none'"]);
  expect(directives.has("upgrade-insecure-requests")).toBe(true);
  expect(policy).not.toContain("*");
  expect(policy).not.toContain("'unsafe-inline'");
  expect(policy).not.toContain("'unsafe-eval'");

  return nonce?.slice("'nonce-".length, -1) ?? "";
}

function expectApiCsp(policy: string) {
  expect(parseCsp(policy)).toEqual(
    new Map([
      ["default-src", ["'none'"]],
      ["base-uri", ["'none'"]],
      ["form-action", ["'none'"]],
      ["frame-ancestors", ["'none'"]],
      ["object-src", ["'none'"]],
    ]),
  );
}

for (const path of [
  "/",
  "/screeners",
  "/traders",
  "/company/AAPL",
  "/company/BRK.B",
  "/account",
  "/account/manual",
  "/__security_headers_missing__",
]) {
  test(`page ${path} receives a unique strict nonce policy`, async ({
    request,
  }) => {
    const first = await request.get(path);
    const second = await request.get(path);

    expect(first.status()).toBeLessThan(500);
    expect(first.headers()["content-type"]).toContain("text/html");
    expectCommonHeaders(first.headers());
    expectCommonHeaders(second.headers());

    const firstNonce = expectDocumentCsp(
      first.headers()["content-security-policy"],
    );
    const secondNonce = expectDocumentCsp(
      second.headers()["content-security-policy"],
    );

    expect(firstNonce).not.toBe(secondNonce);

    const html = await first.text();
    const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];

    expect(scriptTags.length).toBeGreaterThan(0);
    for (const scriptTag of scriptTags) {
      expect(scriptTag).toContain(`nonce="${firstNonce}"`);
    }

    const head = await request.head(path);
    expectCommonHeaders(head.headers());
    expectDocumentCsp(head.headers()["content-security-policy"]);
  });
}

for (const [path, expectedContentType] of [
  ["/api/health/live", "application/json"],
  ["/api/wheel/screener/runs/missing/stream", "application/json"],
  ["/api/finnhub/company/%20", "application/json"],
  ["/api/health/configuration", "application/json"],
  ["/api/logos/AAPL", null],
 ] as const) {
  test(`API response ${path} receives default-deny headers`, async ({
    request,
  }) => {
    const response = await request.get(path);
    const headers = response.headers();

    expect(response.status()).toBeLessThan(600);
    expectCommonHeaders(headers);
    expectApiCsp(headers["content-security-policy"]);

    if (expectedContentType) {
      expect(headers["content-type"]).toContain(expectedContentType);
    }

    if (path === "/api/logos/AAPL" && response.ok()) {
      expect(headers["content-type"]).toBe("image/png");
    }
  });
}

for (const [path, policy] of [
  ["/auth/callback?error=cancelled", "page"],
  ["/api/auth/oauth/unsupported", "api"],
] as const) {
  test(`redirect ${path} preserves security headers`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });
    const headers = response.headers();

    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.status()).toBeLessThan(400);
    expect(headers.location).toBeTruthy();
    expectCommonHeaders(headers);

    if (policy === "page") {
      expectDocumentCsp(headers["content-security-policy"]);
    } else {
      expectApiCsp(headers["content-security-policy"]);
    }
  });
}

test("static assets retain immutable caching and default-deny headers", async ({
  request,
}) => {
  const page = await request.get("/");
  const html = await page.text();
  const assetPath = html.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/)?.[1];

  expect(assetPath).toBeTruthy();

  const asset = await request.get(assetPath!);

  expect(asset.ok()).toBe(true);
  expectCommonHeaders(asset.headers());
  expectApiCsp(asset.headers()["content-security-policy"]);
  expect(asset.headers()["cache-control"]).toContain("immutable");
});

test("representative page flows emit no application CSP violations", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const violations: string[] = [];

    Object.defineProperty(window, "__alphaDogCspViolations", {
      configurable: false,
      value: violations,
      writable: false,
    });
    document.addEventListener("securitypolicyviolation", (event) => {
      const target =
        event.target instanceof Element
          ? event.target.outerHTML.slice(0, 200)
          : event.sourceFile || "document";

      violations.push(
        `${event.effectiveDirective}:${event.blockedURI || "inline"}:${target}`,
      );
    });
  });

  for (
    const path of [
      "/",
      "/screeners",
      "/traders",
      "/company/AAPL",
      "/account",
      "/account/manual",
    ]
  ) {
    await page.goto(path);
    await expect(page.locator("body")).toBeVisible();
  }

  const violations = await page.evaluate(
    () =>
      (window as typeof window & { __alphaDogCspViolations?: string[] })
        .__alphaDogCspViolations ?? [],
  );

  expect(violations).toEqual([]);
});

for (const timezoneId of ["UTC", "America/New_York"]) {
  test.describe(`${timezoneId} dotted ticker runtime`, () => {
    test.use({ timezoneId });

    test("dotted ticker document executes the nonce-authorized framework runtime", async ({
      page,
    }) => {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });

      await page.addInitScript(() => {
        const violations: string[] = [];

        Object.defineProperty(window, "__alphaDogCspViolations", {
          configurable: false,
          value: violations,
          writable: false,
        });
        document.addEventListener("securitypolicyviolation", (event) => {
          const target =
            event.target instanceof Element
              ? event.target.outerHTML.slice(0, 200)
              : event.sourceFile || "document";

          violations.push(
            `${event.effectiveDirective}:${event.blockedURI || "inline"}:${target}`,
          );
        });
      });

      await page.route("**/api/health/configuration", async (route) => {
        await route.fulfill({
          contentType: "application/json",
          json: { mode: "live", status: "ready" },
          status: 200,
        });
      });
      await page.route("**/api/logos/BRK.B?v=1", async (route) => {
        await route.fulfill({
          body: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xn8NAAAAAElFTkSuQmCC",
            "base64",
          ),
          contentType: "image/png",
          status: 200,
        });
      });

      const response = await page.goto(
        `/company/BRK.B?source=security-regression&timezone=${encodeURIComponent(timezoneId)}`,
      );
      expect(response).not.toBeNull();
      expect(response!.status()).toBe(200);
      await expect(page.getByRole("heading", { name: "BRK.B" })).toBeVisible();
      await expect(
        page.getByText("Deterministic timezone regression fixture", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Jul 25, 8:28 AM UTC", { exact: true }),
      ).toBeVisible();

      const policy = response!.headers()["content-security-policy"];
      const responseNonce = expectDocumentCsp(policy);

      const runtime = await page.evaluate(() => {
        const currentWindow = window as typeof window & {
          __alphaDogCspViolations?: string[];
          __alphaDogDottedDocument?: boolean;
        };
        const staticScripts = [...document.scripts].filter((script) =>
          script.src.includes("/_next/static/"),
        );

        currentWindow.__alphaDogDottedDocument = true;

        return {
          staticScriptNonces: staticScripts.map((script) => script.nonce),
          staticScriptCount: staticScripts.length,
          violations: currentWindow.__alphaDogCspViolations ?? [],
        };
      });

      expect(runtime.staticScriptCount).toBeGreaterThan(0);
      expect(runtime.staticScriptNonces).toEqual(
        Array(runtime.staticScriptCount).fill(responseNonce),
      );
      expect(runtime.violations).toEqual([]);

      await page.getByRole("link", { name: "Dashboard" }).click();
      await expect(page).toHaveURL("/");
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as typeof window & {
                __alphaDogDottedDocument?: boolean;
              }).__alphaDogDottedDocument,
          ),
        )
        .toBe(true);

      const finalViolations = await page.evaluate(
        () =>
          (window as typeof window & { __alphaDogCspViolations?: string[] })
            .__alphaDogCspViolations ?? [],
      );

      expect(finalViolations).toEqual([]);
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
    });
  });
}

test("CSP blocks deliberate unapproved browser capabilities", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const violations: string[] = [];

    Object.defineProperty(window, "__alphaDogDeliberateCspViolations", {
      configurable: false,
      value: violations,
      writable: false,
    });
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(event.effectiveDirective);
    });
  });

  await page.route("http://127.0.0.1:3000/", async (route) => {
    const response = await route.fetch();
    const html = await response.text();

    await route.fulfill({
      body: html.replace(
        "<head>",
        "<head><script>window.__alphaDogInjectedScript = true</script>",
      ),
      response,
    });
  });

  await page.goto("/");

  const violations = await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.src = "https://example.com/frame";
    document.body.append(frame);

    const image = document.createElement("img");
    image.src = "https://example.com/image.png";
    document.body.append(image);

    const form = document.createElement("form");
    form.action = "https://example.com/submit";
    document.body.append(form);
    form.requestSubmit();

    await fetch("https://example.com/connect").catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const currentWindow = window as typeof window & {
      __alphaDogDeliberateCspViolations?: string[];
      __alphaDogInjectedScript?: boolean;
    };

    return {
      injectedScript: Boolean(currentWindow.__alphaDogInjectedScript),
      violations: currentWindow.__alphaDogDeliberateCspViolations ?? [],
    };
  });

  expect(violations.injectedScript).toBe(false);
  expect(violations.violations).toEqual(
    expect.arrayContaining([
      "connect-src",
      "form-action",
      "frame-src",
      "img-src",
      "script-src-elem",
    ]),
  );
});
