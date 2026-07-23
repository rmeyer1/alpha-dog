"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

interface TurnstileApi {
  remove(widgetId: string): void;
  render(
    container: HTMLElement,
    options: {
      action: string;
      callback(token: string): void;
      "error-callback"(): void;
      "expired-callback"(): void;
      sitekey: string;
      theme: "dark";
    },
  ): string;
  reset(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export function ManualAccountChallenge({
  onToken,
  required,
  resetKey,
  siteKey,
}: {
  onToken: (token: string | null) => void;
  required: boolean;
  resetKey: number;
  siteKey: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.turnstile),
  );

  useEffect(() => {
    if (!scriptReady || !siteKey || !containerRef.current || !window.turnstile) {
      return;
    }

    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      action: "manual-account",
      callback(token) {
        onToken(token);
      },
      "error-callback"() {
        onToken(null);
      },
      "expired-callback"() {
        onToken(null);
      },
      sitekey: siteKey,
      theme: "dark",
    });

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
      onToken(null);
    };
  }, [onToken, scriptReady, siteKey]);

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
      onToken(null);
    }
  }, [onToken, resetKey]);

  if (!required) {
    return null;
  }

  if (!siteKey || loadFailed) {
    return (
      <p
        aria-live="polite"
        className="rounded-lg border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100"
      >
        Verification is temporarily unavailable. Please try again later.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <Script
        onError={() => setLoadFailed(true)}
        onReady={() => setScriptReady(true)}
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
      />
      <div ref={containerRef} />
      <p className="text-xs leading-5 text-zinc-500">
        Complete the verification before requesting an invitation.
      </p>
    </div>
  );
}
