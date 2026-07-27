import { RouteLoadingState } from "@/components/route-loading-state";

export default function TradersLoading() {
  return (
    <RouteLoadingState
      detail="Preparing leaderboard, whale, sharp-play, and wallet intelligence."
      label="Trader intelligence"
      title="Loading trader signals"
    />
  );
}
