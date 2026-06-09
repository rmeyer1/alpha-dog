import { NextResponse } from "next/server";
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

export async function GET(request: Request) {
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

    const response = await fetchPolymarketLeaderboard(parsed.data);
    setMemoryCache(key, response, polymarketTtlMs.leaderboard);

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "POLYMARKET_LEADERBOARD_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load Polymarket leaderboard.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
