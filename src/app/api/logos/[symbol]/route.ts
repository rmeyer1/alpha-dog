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

function alpacaLogoHeaders() {
  const env = getEnv();
  const key = env.APCA_API_KEY_ID;
  const secret = env.APCA_API_SECRET_KEY;

  if (!key || !secret) {
    return null;
  }

  return {
    "APCA-API-KEY-ID": key,
    "APCA-API-SECRET-KEY": secret,
    Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: symbolParam } = await params;
  const symbol = normalizeSymbol(symbolParam);
  const headers = alpacaLogoHeaders();

  if (!symbol) {
    return logoUnavailableResponse({ reason: "invalid-symbol", status: 400 });
  }

  if (!headers) {
    return logoUnavailableResponse({ reason: "missing-credentials", status: 401 });
  }

  const env = getEnv();
  const logoUrl = new URL(
    `/v1beta1/logos/${encodeURIComponent(symbol)}`,
    env.ALPACA_LOGO_BASE_URL,
  );

  logoUrl.searchParams.set("placeholder", "false");

  const response = await fetch(logoUrl, {
    cache: "no-store",
    headers,
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
      "X-Alpha-Dog-Logo-Result": "alpaca",
    },
  });
}
