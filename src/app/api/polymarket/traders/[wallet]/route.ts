import { NextResponse } from "next/server";
import {
  fetchPolymarketWalletProfile,
  polymarketTtlMs,
} from "@/lib/polymarket/client";
import { getMemoryCache, setMemoryCache } from "@/lib/polymarket/cache";
import type { TraderWalletProfile } from "@/lib/polymarket/types";
import {
  parseSearchParams,
  walletAddressSchema,
  walletQuerySchema,
} from "@/lib/polymarket/validation";

function cacheKey(wallet: string) {
  return `polymarket:wallet:${wallet}`;
}

function withCachedFreshness(
  response: TraderWalletProfile,
  cachedUntil: string,
): TraderWalletProfile {
  return {
    ...response,
    dataFreshness: {
      ...response.dataFreshness,
      cachedUntil,
      cacheStatus: response.dataFreshness.source === "demo" ? "demo" : "fresh",
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ wallet: string }> },
) {
  const { wallet: walletParam } = await params;
  const wallet = walletAddressSchema.safeParse(walletParam);
  const url = new URL(request.url);
  const query = walletQuerySchema.safeParse(parseSearchParams(url.searchParams));

  if (!wallet.success || !query.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_POLYMARKET_WALLET_REQUEST",
          details: {
            query: query.success ? null : query.error.flatten(),
            wallet: wallet.success ? null : wallet.error.flatten(),
          },
          message: "Polymarket wallet request is invalid.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const key = cacheKey(wallet.data);
    const cached = query.data.forceRefresh
      ? null
      : getMemoryCache<TraderWalletProfile>(key);

    if (cached) {
      return NextResponse.json(
        withCachedFreshness(cached.value, cached.cachedUntil),
      );
    }

    const response = await fetchPolymarketWalletProfile({
      forceRefresh: query.data.forceRefresh,
      wallet: wallet.data,
    });
    setMemoryCache(key, response, polymarketTtlMs.wallet);

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          code: "POLYMARKET_WALLET_ERROR",
          message:
            error instanceof Error
              ? error.message
              : "Unable to load Polymarket wallet profile.",
          retryable: true,
        },
      },
      { status: 502 },
    );
  }
}
