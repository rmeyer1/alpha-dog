import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

const logoCacheControl =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";
const missingLogoCacheControl = "public, max-age=3600, s-maxage=3600";

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function logoInitials(symbol: string) {
  const compact = symbol.replace(/[^A-Z0-9]/g, "");

  return compact.slice(0, 2) || "--";
}

function fallbackLogoResponse(symbol: string) {
  const initials = logoInitials(symbol);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="${initials} logo placeholder"><rect width="96" height="96" rx="20" fill="#181b1f"/><rect x="1" y="1" width="94" height="94" rx="19" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2"/><text x="48" y="57" text-anchor="middle" font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" font-size="28" font-weight="700" fill="#d4d4d8">${initials}</text></svg>`;

  return new NextResponse(svg, {
    headers: {
      "Cache-Control": missingLogoCacheControl,
      "Content-Type": "image/svg+xml",
      "X-Alpha-Dog-Logo-Fallback": "1",
    },
  });
}

function brokerAuthorizationHeader() {
  const env = getEnv();
  const key = env.APCA_API_KEY_ID;
  const secret = env.APCA_API_SECRET_KEY;

  if (!key || !secret) {
    return null;
  }

  return `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: symbolParam } = await params;
  const symbol = normalizeSymbol(symbolParam);
  const authorization = brokerAuthorizationHeader();

  if (!symbol || !authorization) {
    return fallbackLogoResponse(symbol);
  }

  const env = getEnv();
  const logoUrl = new URL(
    `/v1beta1/logos/${encodeURIComponent(symbol)}`,
    env.ALPACA_LOGO_BASE_URL,
  );

  logoUrl.searchParams.set("placeholder", "false");

  const response = await fetch(logoUrl, {
    cache: "no-store",
    headers: {
      Authorization: authorization,
    },
  });

  if (!response.ok || !response.body) {
    return fallbackLogoResponse(symbol);
  }

  return new NextResponse(response.body, {
    headers: {
      "Cache-Control": logoCacheControl,
      "Content-Type": response.headers.get("content-type") ?? "image/png",
    },
  });
}
