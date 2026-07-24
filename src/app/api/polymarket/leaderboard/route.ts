import { instrumentApiRoute } from "@/lib/observability/route";
import { NextResponse } from "next/server";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";
import {
  fetchPolymarketLeaderboard,
  polymarketTtlMs,
} from "@/lib/polymarket/client";
import { getMemoryCache, setMemoryCache } from "@/lib/polymarket/cache";
import type { PolymarketLeaderboardResponse } from "@/lib/polymarket/types";
import {
  leaderboardQuerySchema,
  parseSearchParams,
} from "@/lib/polymarket/validation";

function cacheKey(request: unknown) {
  return `polymarket:leaderboard:${JSON.stringify(request)}`;
}

function withCachedFreshness(
  response: PolymarketLeaderboardResponse,
  cachedUntil: string,
): PolymarketLeaderboardResponse {
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
  const parsed = leaderboardQuerySchema.safeParse(
    parseSearchParams(url.searchParams),
  );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_POLYMARKET_LEADERBOARD_REQUEST",
          details: parsed.error.flatten(),
          message: "Polymarket leaderboard request is invalid.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const key = cacheKey(parsed.data);
    const cached = parsed.data.forceRefresh
      ? null
      : getMemoryCache<PolymarketLeaderboardResponse>(key);

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
      const response = await fetchPolymarketLeaderboard(
        parsed.data,
        null,
        guard.signal,
      );
      setMemoryCache(key, response, polymarketTtlMs.leaderboard);

      return guard.withAuthCookies(NextResponse.json(response));
    } finally {
      await guard.release();
    }
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "POLYMARKET_LEADERBOARD_ERROR",
          message: "Unable to load Polymarket leaderboard.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}

export const GET = instrumentApiRoute(
  { method: "GET", route: "/api/polymarket/leaderboard" },
  GETHandler,
);
