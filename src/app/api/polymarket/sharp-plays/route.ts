import { NextResponse } from "next/server";
import {
  fetchPolymarketSharpPlays,
  polymarketTtlMs,
} from "@/lib/polymarket/client";
import { getMemoryCache, setMemoryCache } from "@/lib/polymarket/cache";
import type { PolymarketSharpPlaysResponse } from "@/lib/polymarket/types";
import {
  parseSearchParams,
  sharpPlaysQuerySchema,
} from "@/lib/polymarket/validation";

function cacheKey(request: unknown) {
  return `polymarket:sharp-plays:${JSON.stringify(request)}`;
}

function withCachedFreshness(
  response: PolymarketSharpPlaysResponse,
  cachedUntil: string,
): PolymarketSharpPlaysResponse {
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
  const parsed = sharpPlaysQuerySchema.safeParse(
    parseSearchParams(url.searchParams),
  );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_POLYMARKET_SHARP_PLAYS_REQUEST",
          details: parsed.error.flatten(),
          message: "Polymarket sharp plays request is invalid.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const key = cacheKey(parsed.data);
    const cached = parsed.data.forceRefresh
      ? null
      : getMemoryCache<PolymarketSharpPlaysResponse>(key);

    if (cached) {
      return NextResponse.json(
        withCachedFreshness(cached.value, cached.cachedUntil),
      );
    }

    const response = await fetchPolymarketSharpPlays(parsed.data);
    setMemoryCache(key, response, polymarketTtlMs.sharpPlays);

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "POLYMARKET_SHARP_PLAYS_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load Polymarket sharp plays.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
