import { NextResponse } from "next/server";
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

export async function GET(request: Request) {
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

    const response = await fetchPolymarketWhales(parsed.data);
    setMemoryCache(key, response, polymarketTtlMs.whales);

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "POLYMARKET_WHALES_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load Polymarket whale candidates.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
