import { RouteNotFoundState } from "@/components/route-not-found-state";

export default function NotFound() {
  return (
    <RouteNotFoundState
      message="The address may be outdated or incomplete. Return home to choose an available destination."
      title="We could not find that page"
    />
  );
}
