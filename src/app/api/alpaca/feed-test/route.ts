import { NextResponse } from "next/server";
import { probeOptionsFeed } from "@/lib/alpaca/client";

type OptionsFeed = "opra" | "indicative";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticker = (url.searchParams.get("ticker") ?? "AAPL")
    .trim()
    .toUpperCase();
  const feedParam = url.searchParams.get("feed");
  const feeds: OptionsFeed[] =
    feedParam === "opra" || feedParam === "indicative"
      ? [feedParam]
      : ["opra", "indicative"];
  const results = await Promise.all(
    feeds.map((feed) => probeOptionsFeed(ticker, feed)),
  );

  return NextResponse.json({ ticker, results });
}
