"use client";

import { RouteErrorRecovery } from "@/components/route-error-recovery";

export default function AccountError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorRecovery
      message="The account workspace could not be loaded. No account, position, import, or lifecycle change was made."
      reset={reset}
      title="Account controls are temporarily unavailable"
    />
  );
}
