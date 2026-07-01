"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { CheckCircle2, Link2, XCircle } from "lucide-react";

export function ProviderLinkingForm({
  email,
  nextPath,
  provider,
}: {
  email: string | null;
  nextPath: string;
  provider: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "linking" | "linked">("idle");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setStatus("linking");

    const response = await fetch("/api/auth/provider-link", {
      body: JSON.stringify({
        email,
        nextPath,
        provider,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const payload = await response.json().catch(() => null) as
      | { error?: { message?: string } }
      | null;

    if (!response.ok) {
      setStatus("idle");
      setError(
        payload?.error?.message ??
          "Provider linking is not available yet. Use the original sign-in method.",
      );
      return;
    }

    setStatus("linked");
    router.refresh();
    router.push(nextPath);
  }

  const isLinking = status === "linking";

  return (
    <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          aria-label={`Confirm linking ${provider} to this account`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-emerald-300 px-4 text-sm font-semibold text-[#051626] transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isLinking}
          type="submit"
        >
          <Link2 className="size-4" />
          {isLinking ? "Linking provider" : "Confirm link"}
        </button>
        <a
          aria-label="Cancel provider linking and return to account"
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-4 text-sm font-semibold text-white transition hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-cyan-300 focus:ring-offset-2 focus:ring-offset-[#151718]"
          href="/account"
        >
          <XCircle className="size-4" />
          Cancel
        </a>
      </div>

      {error ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-red-300/25 bg-red-300/10 p-3 text-sm text-red-100"
        >
          {error}
        </p>
      ) : null}

      {status === "linked" ? (
        <p
          aria-live="polite"
          className="inline-flex items-center gap-2 text-sm text-emerald-100"
        >
          <CheckCircle2 className="size-4" />
          Provider linked.
        </p>
      ) : null}
    </form>
  );
}
