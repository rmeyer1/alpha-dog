import { RouteLoadingState } from "@/components/route-loading-state";

export default function RootLoading() {
  return (
    <RouteLoadingState
      detail="Keeping your place while the requested workspace becomes ready."
      label="Alpha Dog"
      title="Loading your next view"
    />
  );
}
