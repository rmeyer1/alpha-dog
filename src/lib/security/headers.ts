export interface PageContentSecurityPolicyOptions {
  isDevelopment: boolean;
  nonce: string;
}

export interface SecurityHeader {
  key: string;
  value: string;
}

export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
export const POLYMARKET_PROFILE_IMAGE_ORIGIN =
  "https://polymarket-upload.s3.us-east-2.amazonaws.com";

export const API_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "browsing-topics=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "payment=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "usb=()",
].join(", ");

export function buildPageContentSecurityPolicy({
  isDevelopment,
  nonce,
}: PageContentSecurityPolicyOptions) {
  if (!/^[A-Za-z0-9+/_=-]+$/.test(nonce)) {
    throw new Error("CSP nonce must use the base64 value character set.");
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    TURNSTILE_ORIGIN,
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
  ];
  const styleSources = [
    "'self'",
    `'nonce-${nonce}'`,
    ...(isDevelopment ? ["'unsafe-inline'"] : []),
  ];
  const connectSources = [
    "'self'",
    TURNSTILE_ORIGIN,
    ...(isDevelopment ? ["ws:", "wss:"] : []),
  ];
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-attr 'none'",
    `style-src ${styleSources.join(" ")}`,
    `style-src-attr ${isDevelopment ? "'unsafe-inline'" : "'none'"}`,
    "font-src 'self'",
    `img-src 'self' ${POLYMARKET_PROFILE_IMAGE_ORIGIN}`,
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "worker-src 'self'",
  ];

  if (!isDevelopment) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function buildSecurityHeaders(): SecurityHeader[] {
  return [
    {
      key: "Content-Security-Policy",
      value: API_CONTENT_SECURITY_POLICY,
    },
    {
      key: "Cross-Origin-Opener-Policy",
      value: "same-origin-allow-popups",
    },
    {
      key: "Cross-Origin-Resource-Policy",
      value: "same-origin",
    },
    {
      key: "Origin-Agent-Cluster",
      value: "?1",
    },
    {
      key: "Permissions-Policy",
      value: PERMISSIONS_POLICY,
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "X-Permitted-Cross-Domain-Policies",
      value: "none",
    },
    {
      key: "X-XSS-Protection",
      value: "0",
    },
  ];
}

export function parseContentSecurityPolicy(policy: string) {
  const directives = new Map<string, string[]>();

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
