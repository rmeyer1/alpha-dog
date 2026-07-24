import {
  elapsedMilliseconds,
  emitTelemetry,
  monotonicNow,
  withTelemetrySpan,
} from "./telemetry";

export const providerNames = [
  "alpaca",
  "finnhub",
  "polymarket",
  "openai",
  "supabase",
] as const;

export type ProviderName = typeof providerNames[number];
export type ProviderOutcome =
  | "success"
  | "http_error"
  | "timeout"
  | "malformed_response"
  | "network_error";

export const privateProviderFetchTracing = {
  ignore: true,
  propagateContext: false,
} as const;

export class ProviderTelemetryError extends Error {
  readonly outcome: Exclude<ProviderOutcome, "success">;
  readonly status: number | null;

  constructor(options: {
    cause?: unknown;
    message: string;
    outcome: Exclude<ProviderOutcome, "success">;
    status?: number | null;
  }) {
    super(options.message, options.cause === undefined
      ? undefined
      : { cause: options.cause });
    this.name = "ProviderTelemetryError";
    this.outcome = options.outcome;
    this.status = options.status ?? null;
  }
}

export function providerHttpError(
  status: number,
  message: string,
  cause?: unknown,
) {
  return new ProviderTelemetryError({
    cause,
    message,
    outcome: "http_error",
    status,
  });
}

export function providerMalformedResponse(
  message: string,
  cause?: unknown,
) {
  return new ProviderTelemetryError({
    cause,
    message,
    outcome: "malformed_response",
  });
}

function numericStatus(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return null;
}

export function classifyProviderFailure(error: unknown): {
  httpStatus: number | undefined;
  outcome: Exclude<ProviderOutcome, "success">;
} {
  if (error instanceof ProviderTelemetryError) {
    return {
      httpStatus: error.status ?? undefined,
      outcome: error.outcome,
    };
  }

  const status = numericStatus(error);

  if (status != null) {
    return { httpStatus: status, outcome: "http_error" };
  }

  const name =
    error && typeof error === "object" && "name" in error
      ? String(error.name)
      : "";

  if (name === "AbortError" || name === "TimeoutError") {
    return { httpStatus: undefined, outcome: "timeout" };
  }

  if (error instanceof SyntaxError || name === "ZodError") {
    return { httpStatus: undefined, outcome: "malformed_response" };
  }

  return { httpStatus: undefined, outcome: "network_error" };
}

export async function observeProviderCall<T>(
  provider: ProviderName,
  operation: string,
  callback: () => Promise<T>,
) {
  const startedAt = monotonicNow();

  return withTelemetrySpan(
    `provider.${provider}.${operation}`,
    {
      "provider.name": provider,
      "provider.operation": operation,
    },
    async () => {
      try {
        const result = await callback();

        emitTelemetry({
          durationMs: elapsedMilliseconds(startedAt),
          event: "provider.request",
          operation,
          outcome: "success",
          provider,
        });

        return result;
      } catch (error) {
        const classified = classifyProviderFailure(error);

        emitTelemetry({
          durationMs: elapsedMilliseconds(startedAt),
          error,
          errorCode: classified.outcome.toUpperCase(),
          event: "provider.request",
          httpStatus: classified.httpStatus,
          operation,
          outcome: classified.outcome,
          provider,
          severity: "warn",
        });

        throw error;
      }
    },
  );
}
