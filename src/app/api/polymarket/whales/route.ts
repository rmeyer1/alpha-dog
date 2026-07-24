import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";
import {
  fetchPolymarketWhales,
  polymarketTtlMs,
} from "@/lib/polymarket/client";
import { getMemoryCache, setMemoryCache } from "@/lib/polymarket/cache";
import type { PolymarketWhalesResponse } from "@/lib/polymarket/types";
import {
  parseSearchParams,
  whaleQuerySchema,
} from "@/lib/polymarket/validation";

function cacheKey(request: unknown) {
  return `polymarket:whales:${JSON.stringify(request)}`;
}

function withCachedFreshness(
  response: PolymarketWhalesResponse,
  cachedUntil: string,
): PolymarketWhalesResponse {
  return {
    ...response,
    dataFreshness: {
      ...response.dataFreshness,
      cachedUntil,
      cacheStatus: response.dataFreshness.source === "demo" ? "demo" : "fresh",
    },
  };
}

async function GETHandler(request: Request) {
  const url = new URL(request.url);
  const parsed = whaleQuerySchema.safeParse(parseSearchParams(url.searchParams));

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_POLYMARKET_WHALES_REQUEST",
          details: parsed.error.flatten(),
          message: "Polymarket whale request is invalid.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const key = cacheKey(parsed.data);
    const cached = parsed.data.forceRefresh
      ? null
      : getMemoryCache<PolymarketWhalesResponse>(key);

    if (cached) {
      return NextResponse.json(
        withCachedFreshness(cached.value, cached.cachedUntil),
      );
    }

    const guard = await acquirePaidRouteGuard(
      request,
      parsed.data.forceRefresh
        ? "polymarketForceRefresh"
        : "polymarketCacheMiss",
    );

    if (!guard.allowed) {
      return guard.response;
    }

    try {
      const response = await fetchPolymarketWhales(
        parsed.data,
        null,
        guard.signal,
      );
      setMemoryCache(key, response, polymarketTtlMs.whales);

      return guard.withAuthCookies(NextResponse.json(response));
    } finally {
      await guard.release();
    }
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "POLYMARKET_WHALES_ERROR",
          message: "Unable to load Polymarket whale candidates.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/polymarket/whales" },
  GETHandler,
);
