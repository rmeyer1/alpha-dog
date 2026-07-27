import { pathToFileURL } from "node:url";

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const POLYMARKET_PROFILE_IMAGE_ORIGIN =
  "https://polymarket-upload.s3.us-east-2.amazonaws.com";
const API_CSP = new Map([
  ["default-src", ["'none'"]],
  ["base-uri", ["'none'"]],
  ["form-action", ["'none'"]],
  ["frame-ancestors", ["'none'"]],
  ["object-src", ["'none'"]],
]);
const COMMON_HEADERS = new Map([
  ["cross-origin-opener-policy", "same-origin-allow-popups"],
  ["cross-origin-resource-policy", "same-origin"],
  ["origin-agent-cluster", "?1"],
  ["referrer-policy", "strict-origin-when-cross-origin"],
  ["x-content-type-options", "nosniff"],
  ["x-frame-options", "DENY"],
  ["x-permitted-cross-domain-policies", "none"],
  ["x-xss-protection", "0"],
]);
const PRODUCTION_HSTS = "max-age=63072000; includeSubDomains; preload";
const PAGE_PATHS = [
  "/",
  "/screeners",
  "/traders",
  "/company/AAPL",
  "/account",
  "/account/manual",
  "/__security_headers_missing__",
];
const API_PATHS = [
  { contentType: "application/json", path: "/api/health/live" },
  {
    contentType: "application/json",
    path: "/api/wheel/screener/runs/missing/stream",
  },
  { contentType: null, path: "/api/logos/AAPL" },
  {
    contentType: "application/json",
    path: "/api/finnhub/company/%20",
  },
  {
    contentType: "application/json",
    path: "/api/health/configuration",
  },
];
const REDIRECT_PATHS = [
  { path: "/auth/callback?error=cancelled", policy: "page" },
  { path: "/api/auth/oauth/unsupported", policy: "api" },
];

function parseCsp(policy) {
  const directives = new Map();

  if (!policy || policy.includes(",")) {
    throw new Error("CSP is absent or appears to contain duplicate headers.");
  }

  for (const rawDirective of policy.split(";")) {
    const normalized = rawDirective.trim();

    if (!normalized) {
      continue;
    }

    const [name, ...values] = normalized.split(/\s+/);

    if (!name || directives.has(name)) {
      throw new Error(`Invalid or duplicate CSP directive: ${name || "<empty>"}`);
    }

    directives.set(name, values);
  }

  return directives;
}

function expectDirective(directives, name, expected) {
  const actual = directives.get(name);

  if (
    !actual ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `${name} was ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`,
    );
  }
}

function verifyPageCsp(policy) {
  const directives = parseCsp(policy);
  const scriptSources = directives.get("script-src") ?? [];
  const nonceSources = scriptSources.filter((value) =>
    /^'nonce-[A-Za-z0-9+/_=-]+'$/.test(value)
  );

  if (nonceSources.length !== 1) {
    throw new Error("script-src must contain exactly one valid nonce.");
  }

  const nonce = nonceSources[0];

  expectDirective(directives, "default-src", ["'self'"]);
  expectDirective(directives, "base-uri", ["'self'"]);
  expectDirective(directives, "script-src", [
    "'self'",
    nonce,
    "'strict-dynamic'",
    TURNSTILE_ORIGIN,
  ]);
  expectDirective(directives, "script-src-attr", ["'none'"]);
  expectDirective(directives, "style-src", ["'self'", nonce]);
  expectDirective(directives, "style-src-attr", ["'none'"]);
  expectDirective(directives, "font-src", ["'self'"]);
  expectDirective(directives, "img-src", [
    "'self'",
    POLYMARKET_PROFILE_IMAGE_ORIGIN,
  ]);
  expectDirective(directives, "connect-src", ["'self'", TURNSTILE_ORIGIN]);
  expectDirective(directives, "frame-src", [TURNSTILE_ORIGIN]);
  expectDirective(directives, "frame-ancestors", ["'none'"]);
  expectDirective(directives, "form-action", ["'self'"]);
  expectDirective(directives, "object-src", ["'none'"]);

  if (
    policy.includes("*") ||
    policy.includes("'unsafe-inline'") ||
    policy.includes("'unsafe-eval'") ||
    policy.includes("https:") && !policy.includes("https://")
  ) {
    throw new Error("Production page CSP contains a forbidden broad source.");
  }

  return nonce.slice("'nonce-".length, -1);
}

function verifyApiCsp(policy) {
  const directives = parseCsp(policy);

  if (directives.size !== API_CSP.size) {
    throw new Error("Non-document CSP contains unexpected directives.");
  }

  for (const [name, values] of API_CSP) {
    expectDirective(directives, name, values);
  }
}

function requestHeaders() {
  const headers = new Headers();
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

  if (bypass) {
    headers.set("x-vercel-protection-bypass", bypass);
    headers.set("x-vercel-set-bypass-cookie", "true");
  }

  return headers;
}

function verifyCommonHeaders(response, { expectHsts }) {
  for (const [name, expected] of COMMON_HEADERS) {
    if (response.headers.get(name) !== expected) {
      throw new Error(
        `${name} was ${response.headers.get(name)} instead of ${expected}`,
      );
    }
  }

  const permissionsPolicy = response.headers.get("permissions-policy") ?? "";

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
    if (!permissionsPolicy.split(/,\s*/).includes(feature)) {
      throw new Error(`Permissions-Policy omitted ${feature}`);
    }
  }

  if (response.headers.has("x-powered-by")) {
    throw new Error("x-powered-by exposes the framework.");
  }

  const hsts = response.headers.get("strict-transport-security");

  if (expectHsts && hsts !== PRODUCTION_HSTS) {
    throw new Error(`HSTS was ${hsts} instead of ${PRODUCTION_HSTS}`);
  }

  if (!expectHsts && hsts) {
    throw new Error("The application emitted HSTS on a local HTTP response.");
  }
}

async function fetchChecked(baseUrl, path, init = {}) {
  const headers = requestHeaders();

  for (const [name, value] of new Headers(init.headers)) {
    headers.set(name, value);
  }

  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers,
    redirect: init.redirect ?? "manual",
  });

  return response;
}

function staticAssetPath(html) {
  return html.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/)?.[1] ?? null;
}

export async function verifySecurityHeaders(baseUrlValue) {
  const baseUrl = new URL(baseUrlValue);
  const expectHsts = baseUrl.protocol === "https:";
  const results = [];
  let firstPageHtml = "";

  for (const path of PAGE_PATHS) {
    const response = await fetchChecked(baseUrl, path);
    const failures = [];

    try {
      verifyCommonHeaders(response, { expectHsts });
      const nonce = verifyPageCsp(
        response.headers.get("content-security-policy"),
      );
      const contentType = response.headers.get("content-type") ?? "";

      if (!contentType.startsWith("text/html")) {
        throw new Error(`Expected HTML but received ${contentType || "none"}`);
      }

      const html = await response.text();
      const scriptTags = html.match(/<script\b[^>]*>/gi) ?? [];

      if (scriptTags.length === 0) {
        throw new Error("HTML contained no framework script tags.");
      }

      for (const tag of scriptTags) {
        if (!tag.includes(`nonce="${nonce}"`)) {
          throw new Error("A framework script omitted the response nonce.");
        }
      }

      if (path === "/") {
        firstPageHtml = html;
      }

      const head = await fetchChecked(baseUrl, path, { method: "HEAD" });
      verifyCommonHeaders(head, { expectHsts });
      verifyPageCsp(head.headers.get("content-security-policy"));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    results.push({ failures, path, status: response.status });
  }

  for (const check of API_PATHS) {
    const response = await fetchChecked(baseUrl, check.path);
    const failures = [];

    try {
      verifyCommonHeaders(response, { expectHsts });
      verifyApiCsp(response.headers.get("content-security-policy"));

      const contentType = response.headers.get("content-type") ?? "";

      if (check.contentType && !contentType.startsWith(check.contentType)) {
        throw new Error(
          `Expected ${check.contentType} but received ${contentType || "none"}`,
        );
      }

      if (
        check.path === "/api/logos/AAPL" &&
        response.ok &&
        contentType !== "image/png"
      ) {
        throw new Error(`Successful logo response used ${contentType}`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    results.push({ failures, path: check.path, status: response.status });
  }

  for (const check of REDIRECT_PATHS) {
    const response = await fetchChecked(baseUrl, check.path);
    const failures = [];

    try {
      verifyCommonHeaders(response, { expectHsts });

      if (response.status < 300 || response.status >= 400) {
        throw new Error(`Expected a redirect but received ${response.status}`);
      }

      if (!response.headers.get("location")) {
        throw new Error("Redirect omitted Location.");
      }

      if (check.policy === "page") {
        verifyPageCsp(response.headers.get("content-security-policy"));
      } else {
        verifyApiCsp(response.headers.get("content-security-policy"));
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    results.push({ failures, path: check.path, status: response.status });
  }

  const assetPath = staticAssetPath(firstPageHtml);

  if (!assetPath) {
    results.push({
      failures: ["Unable to resolve a static Next.js asset from the home page."],
      path: "/_next/static/<discovery>",
      status: 0,
    });
  } else {
    const response = await fetchChecked(baseUrl, assetPath);
    const failures = [];

    try {
      verifyCommonHeaders(response, { expectHsts });
      verifyApiCsp(response.headers.get("content-security-policy"));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    results.push({ failures, path: assetPath, status: response.status });
  }

  return {
    baseUrl: baseUrl.origin,
    passed: results.every((result) => result.failures.length === 0),
    results,
  };
}

async function main() {
  const baseUrl = process.env.SECURITY_HEADERS_BASE_URL ?? process.argv[2];

  if (!baseUrl) {
    throw new Error(
      "Set SECURITY_HEADERS_BASE_URL or pass a deployment URL as the first argument.",
    );
  }

  const report = await verifySecurityHeaders(baseUrl);

  console.log(JSON.stringify(report, null, 2));

  if (!report.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
