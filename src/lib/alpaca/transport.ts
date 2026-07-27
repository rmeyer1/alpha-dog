import { getEnv } from "@/lib/env";
import {
  observeProviderCall,
  privateProviderFetchTracing,
  providerHttpError,
  providerMalformedResponse,
} from "@/lib/observability/provider";
import { withProviderTimeout } from "@/lib/provider-timeout";

const RETRY_DELAYS_MS = [250, 750, 1500, 3000];
const MAX_RETRY_AFTER_MS = 30_000;

class RequestLimiter {
  private active = 0;
  private tokens = 1;
  private updatedAt = Date.now();
  private queue: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  async acquire(signal?: AbortSignal) {
    if (process.env.NODE_ENV === "test" || process.env.VITEST) return () => {};
    signal?.throwIfAborted();
    return new Promise<() => void>((resolve, reject) => {
      const admit = () => {
        signal?.removeEventListener("abort", abort);
        resolve(() => {
          this.active -= 1;
          this.pump();
        });
      };
      const abort = () => {
        const index = this.queue.indexOf(admit);
        if (index >= 0) this.queue.splice(index, 1);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(admit);
      this.pump();
    });
  }
  private pump() {
    const env = getEnv();
    const rate = env.ALPACA_MARKET_DATA_RATE_LIMIT_PER_MINUTE;
    const capacity = Math.max(
      1,
      Math.min(
        env.ALPACA_MARKET_DATA_MAX_CONCURRENCY * 2,
        Math.ceil(rate / 60),
      ),
    );
    const now = Date.now();
    this.tokens = Math.min(
      capacity,
      this.tokens + (Math.max(0, now - this.updatedAt) * rate) / 60_000,
    );
    this.updatedAt = now;
    while (
      this.queue.length &&
      this.active < env.ALPACA_MARKET_DATA_MAX_CONCURRENCY &&
      this.tokens >= 1
    ) {
      this.tokens -= 1;
      this.active += 1;
      this.queue.shift()?.();
    }
    if (
      this.queue.length &&
      !this.timer &&
      this.tokens < 1 &&
      this.active < env.ALPACA_MARKET_DATA_MAX_CONCURRENCY
    )
      this.timer = setTimeout(
        () => {
          this.timer = undefined;
          this.pump();
        },
        Math.max(1, Math.ceil((1 - this.tokens) / (rate / 60_000))),
      );
  }
}
const requestLimiter = new RequestLimiter();

export function alpacaHeaders() {
  const env = getEnv();
  if (!env.APCA_API_KEY_ID || !env.APCA_API_SECRET_KEY)
    throw new Error("Alpaca credentials are not configured.");
  return {
    "APCA-API-KEY-ID": env.APCA_API_KEY_ID,
    "APCA-API-SECRET-KEY": env.APCA_API_SECRET_KEY,
  };
}
function retryAfterMs(headers: Headers) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds))
      return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, seconds * 1000));
    const timestamp = new Date(retryAfter).getTime();
    if (Number.isFinite(timestamp))
      return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, timestamp - Date.now()));
  }
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(reset)) return null;
  return Math.min(
    MAX_RETRY_AFTER_MS,
    Math.max(0, (reset < 10_000_000_000 ? reset * 1000 : reset) - Date.now()),
  );
}
function canRetry(status: number) {
  return status === 408 || status === 429 || status >= 500;
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Server-only provider transport: timeout, no-store policy, and retry semantics. */
export async function fetchAlpacaJson<T>(
  url: URL,
  signal?: AbortSignal,
): Promise<T> {
  const operation = url.pathname.includes("/options/")
    ? "options_data"
    : url.pathname.includes("/stocks/")
      ? "stock_data"
      : url.pathname.endsWith("/assets")
        ? "assets"
        : url.pathname.endsWith("/clock")
          ? "clock"
          : "request";
  return observeProviderCall("alpaca", operation, async () => {
    const providerSignal = withProviderTimeout(signal, 30_000);
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const release = await requestLimiter.acquire(providerSignal);
      let released = false;
      try {
        const response = await fetch(url, {
          headers: alpacaHeaders(),
          cache: "no-store",
          opentelemetry: privateProviderFetchTracing,
          signal: providerSignal,
        });
        let body: (T & { message?: string }) | null;
        try {
          body = (await response.json()) as T & { message?: string };
        } catch (error) {
          if (response.ok)
            throw providerMalformedResponse(
              "Alpaca returned a malformed response.",
              error,
            );
          body = null;
        }
        if (response.ok) {
          if (!body)
            throw providerMalformedResponse(
              "Alpaca returned an empty response.",
            );
          return body;
        }
        const requestId = response.headers.get("x-request-id");
        const message =
          body?.message ?? `Alpaca returned HTTP ${response.status}.`;
        if (attempt < RETRY_DELAYS_MS.length && canRetry(response.status)) {
          release();
          released = true;
          await delay(
            retryAfterMs(response.headers) ?? RETRY_DELAYS_MS[attempt],
            providerSignal,
          );
          continue;
        }
        throw providerHttpError(
          response.status,
          requestId ? `${message} Request ID: ${requestId}.` : message,
        );
      } finally {
        if (!released) release();
      }
    }
    throw new Error("Alpaca request failed after retries.");
  });
}
