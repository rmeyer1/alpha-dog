import { NextResponse } from "next/server";
import {
  fetchPolymarketMomentum,
  polymarketTtlMs,
} from "@/lib/polymarket/client";
import { getMemoryCache, setMemoryCache } from "@/lib/polymarket/cache";
import type { PolymarketMomentumResponse } from "@/lib/polymarket/types";
import {
  momentumQuerySchema,
  parseSearchParams,
} from "@/lib/polymarket/validation";

function cacheKey(request: unknown) {
  return `polymarket:momentum:${JSON.stringify(request)}`;
}

function withCachedFreshness(
  response: PolymarketMomentumResponse,
  cachedUntil: string,
): PolymarketMomentumResponse {
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
  const parsed = momentumQuerySchema.safeParse(
    parseSearchParams(url.searchParams),
  );

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_POLYMARKET_MOMENTUM_REQUEST",
          details: parsed.error.flatten(),
          message: "Polymarket momentum request is invalid.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const key = cacheKey(parsed.data);
    const cached = parsed.data.forceRefresh
      ? null
      : getMemoryCache<PolymarketMomentumResponse>(key);

    if (cached) {
      return NextResponse.json(
        withCachedFreshness(cached.value, cached.cachedUntil),
      );
    }

    const response = await fetchPolymarketMomentum(parsed.data);
    setMemoryCache(key, response, polymarketTtlMs.momentum);

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "POLYMARKET_MOMENTUM_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load Polymarket momentum traders.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
