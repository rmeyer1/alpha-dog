import type { WheelScreenerResponse } from "./types";

export function shouldAutoRefreshScreenerResponse({
  alreadyRefreshed,
  response,
}: {
  alreadyRefreshed: boolean;
  response: WheelScreenerResponse | null;
}) {
  if (alreadyRefreshed || !response) {
    return false;
  }

  const freshness = response.dataFreshness;

  return (
    freshness.source === "materialized" &&
    freshness.refreshStatus !== "refreshing" &&
    freshness.cacheStatus === "stale"
  );
}
