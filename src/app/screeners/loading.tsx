import { RouteLoadingState } from "@/components/route-loading-state";

export default function ScreenersLoading() {
  return (
    <RouteLoadingState
      detail="Preparing filters, market context, and the candidate results workspace."
      label="Wheel screener"
      title="Loading strategy candidates"
    />
  );
}
