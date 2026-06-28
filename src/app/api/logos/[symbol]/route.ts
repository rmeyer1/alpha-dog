import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

const logoCacheControl =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const missingLogoCacheControl = "public, max-age=3600, s-maxage=3600";

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
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

export async function GET(
  _request: Request,
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

  const response = await fetch(logoUrl, {
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    return logoUnavailableResponse({
      reason: "upstream-unavailable",
      status: response.status,
      upstreamStatus: response.status,
    });
  }

  return new NextResponse(response.body, {
    headers: {
      "Cache-Control": logoCacheControl,
      "Content-Type": response.headers.get("content-type") ?? "image/png",
      "X-Alpha-Dog-Logo-Result": "logo-dev",
    },
  });
}
