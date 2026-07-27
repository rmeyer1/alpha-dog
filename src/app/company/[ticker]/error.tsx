"use client";

import { RouteErrorRecovery } from "@/components/route-error-recovery";

export default function CompanyError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorRecovery
      message="The company profile could not finish loading. Retry to request the market and filing data again."
      reset={reset}
      title="Company data is temporarily unavailable"
    />
  );
}
