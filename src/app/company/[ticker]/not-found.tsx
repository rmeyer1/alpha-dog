import { RouteNotFoundState } from "@/components/route-not-found-state";

export default function CompanyNotFound() {
  return (
    <RouteNotFoundState
      backHref="/screeners"
      backLabel="Return to screeners"
      message="Check the ticker symbol and try again from the screener. Symbols must identify a supported U.S. equity."
      title="Company symbol not found"
    />
  );
}
