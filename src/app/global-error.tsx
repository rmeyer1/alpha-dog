"use client";

import { RouteErrorRecovery } from "@/components/route-error-recovery";

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <RouteErrorRecovery
          message="The application shell could not finish loading. Retry the request or return to the Alpha Dog home page."
          reset={reset}
          title="Alpha Dog needs another try"
        />
      </body>
    </html>
  );
}
