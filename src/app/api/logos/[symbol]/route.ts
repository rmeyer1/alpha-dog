import { instrumentApiRoute } from "@/lib/observability/route";
import { privateProviderFetchTracing } from "@/lib/observability/provider";
import { NextResponse } from "next/server";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";
import { getEnv } from "@/lib/env";
import { readBoundedBody } from "@/lib/http/read-bounded-body";

const logoCacheControl =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const missingLogoCacheControl = "public, max-age=3600, s-maxage=3600";
const expectedLogoContentType = "image/png";
const maxLogoBytes = 1_000_000;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

export function isSafePng(bytes: Uint8Array) {
  return bytes.length >= pngSignature.length &&
    bytes.length <= maxLogoBytes &&
    pngSignature.every((byte, index) => bytes[index] === byte);
}

function logoUnavailableResponse({
  reason,
  status,
  upstreamStatus,
}: {
  reason: string;
  status: number;
  upstreamStatus?: number;
}) {
  const headers = new Headers({
    "Cache-Control": missingLogoCacheControl,
    "X-Alpha-Dog-Logo-Result": "fallback",
    "X-Alpha-Dog-Logo-Reason": reason,
  });

  if (upstreamStatus) {
    headers.set("X-Alpha-Dog-Logo-Upstream-Status", String(upstreamStatus));
  }

  return new NextResponse(null, {
    headers: {
      ...Object.fromEntries(headers),
    },
    status,
  });
}

function getLogoDevToken() {
  const env = getEnv();

  if (!env.LOGO_DEV_PUBLISHABLE_KEY) {
    return null;
  }

  return env.LOGO_DEV_PUBLISHABLE_KEY;
}

function hasUnsafeDeclaredLength(value: string | null) {
  if (value === null) {
    return false;
  }

  const normalized = value.trim();

  if (!/^\d+$/.test(normalized)) {
    return true;
  }

  const contentLength = Number(normalized);

  return !Number.isSafeInteger(contentLength) || contentLength > maxLogoBytes;
}

async function GETHandler(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: symbolParam } = await params;
  const symbol = normalizeSymbol(symbolParam);
  const token = getLogoDevToken();

  if (!symbol) {
    return logoUnavailableResponse({ reason: "invalid-symbol", status: 400 });
  }

  if (!token) {
    return logoUnavailableResponse({ reason: "missing-credentials", status: 401 });
  }

  const env = getEnv();
  const logoUrl = new URL(`/ticker/${encodeURIComponent(symbol)}`, env.LOGO_DEV_BASE_URL);

  logoUrl.searchParams.set("token", token);
  logoUrl.searchParams.set("size", "128");
  logoUrl.searchParams.set("format", "png");
  logoUrl.searchParams.set("theme", "dark");
  logoUrl.searchParams.set("retina", "true");
  logoUrl.searchParams.set("fallback", "404");

  const guard = await acquirePaidRouteGuard(request, "logoCacheMiss");

  if (!guard.allowed) {
    return guard.response;
  }

  try {
    const response = await fetch(logoUrl, {
      cache: "no-store",
      opentelemetry: privateProviderFetchTracing,
      signal: guard.signal,
    });

    const contentType = response.headers.get("content-type")
      ?.split(";", 1)[0]
      .trim()
      .toLowerCase();

    if (
      !response.ok ||
      contentType !== expectedLogoContentType
    ) {
      return guard.withAuthCookies(logoUnavailableResponse({
        reason: response.ok ? "unsafe-content-type" : "upstream-unavailable",
        status: response.ok ? 502 : response.status,
        upstreamStatus: response.status,
      }));
    }

    if (hasUnsafeDeclaredLength(response.headers.get("content-length"))) {
      try {
        await response.body?.cancel("unsafe declared content length");
      } catch {
        // The response is rejected even when the upstream cannot be cancelled.
      }

      return guard.withAuthCookies(logoUnavailableResponse({
        reason: "unsafe-image-body",
        status: 502,
        upstreamStatus: response.status,
      }));
    }

    let bodyResult;

    try {
      bodyResult = await readBoundedBody(response.body, maxLogoBytes);
    } catch {
      return guard.withAuthCookies(logoUnavailableResponse({
        reason: "unsafe-image-body",
        status: 502,
        upstreamStatus: response.status,
      }));
    }

    if (bodyResult.status === "too-large" || !isSafePng(bodyResult.bytes)) {
      return guard.withAuthCookies(logoUnavailableResponse({
        reason: "unsafe-image-body",
        status: 502,
        upstreamStatus: response.status,
      }));
    }

    return guard.withAuthCookies(new NextResponse(bodyResult.bytes, {
      headers: {
        "Cache-Control": logoCacheControl,
        "Content-Disposition": `inline; filename="${symbol}.png"`,
        "Content-Type": expectedLogoContentType,
        "X-Content-Type-Options": "nosniff",
        "X-Alpha-Dog-Logo-Result": "logo-dev",
      },
    }));
  } finally {
    await guard.release();
  }
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/logos/[symbol]" },
  GETHandler,
);
