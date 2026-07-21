import { NextResponse } from "next/server";
import { acquirePaidRouteGuard } from "@/lib/api-abuse/guard";
import { probeOptionsFeed } from "@/lib/alpaca/client";

type OptionsFeed = "opra" | "indicative";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get("ticker") ?? "AAPL")
    .trim()
    .toUpperCase();

  if (!/^[A-Z0-9.-]{1,12}$/.test(ticker)) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_ALPACA_FEED_TEST_REQUEST",
          message: "A valid ticker is required.",
        },
      },
      { status: 400 },
    );
  }

  const guard = await acquirePaidRouteGuard(request, "alpacaFeedTest");

  if (!guard.allowed) {
    return guard.response;
  }

  const feedParam = url.searchParams.get("feed");
  const feeds: OptionsFeed[] =
    feedParam === "opra" || feedParam === "indicative"
      ? [feedParam]
      : ["opra", "indicative"];
  try {
    const results = await Promise.all(
      feeds.map((feed) => probeOptionsFeed(ticker, feed, guard.signal)),
    );

    return guard.withAuthCookies(NextResponse.json({ ticker, results }));
  } finally {
    await guard.release();
  }
}
