"use client";

import { RouteErrorRecovery } from "@/components/route-error-recovery";

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteErrorRecovery
      message="Alpha Dog could not finish loading this page. Your saved account data was not changed."
      reset={reset}
      title="This page needs another try"
    />
  );
}
