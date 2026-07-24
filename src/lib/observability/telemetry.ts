import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";
import { activeTelemetryContext } from "./context";

export type TelemetrySeverity = "debug" | "info" | "warn" | "error";

export interface TelemetryEvent {
  ageMs?: number;
  alertKey?: string;
  attempt?: number;
  cacheState?: string;
  correlationId?: string;
  durationMs?: number;
  error?: unknown;
  errorCode?: string;
  event: string;
  httpStatus?: number;
  logicalOperationId?: string;
  operation?: string;
  outcome?: string;
  provider?: string;
  route?: string;
  severity?: TelemetrySeverity;
  workflow?: string;
}

const MAX_DURATION_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPT = 100;
const SAFE_EVENT_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const SAFE_DIMENSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const SAFE_ROUTE_PATTERN = /^\/[A-Za-z0-9/_.:[\]-]{0,127}$/;
const SAFE_CORRELATION_PATTERN =
  /^(?=[A-Za-z0-9._:-]{1,64}$)(?=.*[0-9._:-])[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const SAFE_ERROR_CLASSES = new Set([
  "AbortError",
  "AlpacaHttpError",
  "Error",
  "ProviderTelemetryError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
  "UnknownError",
  "ZodError",
]);

function safeDimension(value: unknown, fallback: string) {
  return typeof value === "string" && SAFE_DIMENSION_PATTERN.test(value)
    ? value
    : fallback;
}

function safeRoute(value: unknown) {
  return typeof value === "string" && SAFE_ROUTE_PATTERN.test(value)
    ? value
    : undefined;
}

function safeCorrelationId(value: unknown) {
  return typeof value === "string" && SAFE_CORRELATION_PATTERN.test(value)
    ? value
    : undefined;
}

function safeBoundedNumber(
  value: unknown,
  maximum: number,
  decimals = 0,
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const bounded = Math.min(maximum, Math.max(0, value));
  const factor = 10 ** decimals;

  return Math.round(bounded * factor) / factor;
}

export function safeErrorClass(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    typeof error.name === "string"
  ) {
    return SAFE_ERROR_CLASSES.has(error.name)
      ? error.name
      : "UnknownError";
  }

  return "UnknownError";
}

export function serializeTelemetryEvent(input: TelemetryEvent) {
  const active = activeTelemetryContext();
  const event = SAFE_EVENT_PATTERN.test(input.event)
    ? input.event
    : "telemetry.invalid_event";
  const severity = input.severity ?? "info";
  const record: Record<string, boolean | number | string> = {
    event,
    severity,
    telemetryVersion: 1,
  };
  const correlationId = safeCorrelationId(
    input.correlationId ?? active?.correlationId,
  );
  const route = safeRoute(input.route ?? active?.route);
  const durationMs = safeBoundedNumber(input.durationMs, MAX_DURATION_MS, 2);
  const ageMs = safeBoundedNumber(input.ageMs, MAX_AGE_MS);
  const attempt = safeBoundedNumber(input.attempt, MAX_ATTEMPT);

  if (correlationId) record.correlationId = correlationId;
  if (route) record.route = route;
  if (durationMs != null) record.durationMs = durationMs;
  if (ageMs != null) record.ageMs = ageMs;
  if (attempt != null) record.attempt = attempt;
  if (input.httpStatus != null) {
    record.httpStatus = Math.min(
      599,
      Math.max(100, Math.trunc(input.httpStatus)),
    );
  }
  if (input.operation != null) {
    record.operation = safeDimension(input.operation, "unknown");
  }
  if (input.outcome != null) {
    record.outcome = safeDimension(input.outcome, "unknown");
  }
  if (input.provider != null) {
    record.provider = safeDimension(input.provider, "unknown");
  }
  if (input.cacheState != null) {
    record.cacheState = safeDimension(input.cacheState, "unknown");
  }
  if (input.errorCode != null) {
    record.errorCode = safeDimension(input.errorCode, "UNKNOWN");
  }
  if (input.workflow != null) {
    record.workflow = safeDimension(input.workflow, "unknown");
  }
  if (input.logicalOperationId != null) {
    const logicalOperationId = safeCorrelationId(input.logicalOperationId);

    if (logicalOperationId) {
      record.logicalOperationId = logicalOperationId;
    }
  }
  if (input.alertKey != null) {
    record.alertKey = safeDimension(input.alertKey, "unknown");
  }
  if (input.error !== undefined) {
    record.errorClass = safeErrorClass(input.error);
  }

  return JSON.stringify(record);
}

export function emitTelemetry(input: TelemetryEvent) {
  try {
    const serialized = serializeTelemetryEvent(input);

    if (input.severity === "error") {
      console.error(serialized);
    } else if (input.severity === "warn") {
      console.warn(serialized);
    } else if (input.severity === "debug") {
      console.debug(serialized);
    } else {
      console.info(serialized);
    }
  } catch {
    console.error(
      '{"event":"telemetry.serialization_failed","severity":"error","telemetryVersion":1}',
    );
  }
}

function safeSpanAttributes(
  attributes: Record<string, string | number | undefined>,
): Attributes {
  const safe: Attributes = {};

  for (const [key, value] of Object.entries(attributes)) {
    if (
      SAFE_DIMENSION_PATTERN.test(key) &&
      (
        typeof value === "number"
          ? Number.isFinite(value)
          : typeof value === "string" &&
            SAFE_DIMENSION_PATTERN.test(value)
      )
    ) {
      safe[key] = value;
    }
  }

  const active = activeTelemetryContext();

  if (active?.correlationId) {
    safe["alpha_dog.correlation_id"] = active.correlationId;
  }
  if (active?.route) {
    safe["alpha_dog.route"] = active.route;
  }

  return safe;
}

export async function withTelemetrySpan<T>(
  name: string,
  attributes: Record<string, string | number | undefined>,
  callback: (span: Span) => Promise<T>,
  options: { automaticStatus?: boolean } = {},
) {
  const safeName = safeDimension(name, "alpha_dog.unknown");

  return trace
    .getTracer("alpha-dog")
    .startActiveSpan(safeName, async (span) => {
      span.setAttributes(safeSpanAttributes(attributes));

      try {
        const result = await callback(span);

        if (options.automaticStatus !== false) {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        return result;
      } catch (error) {
        span.setAttribute("error.type", safeErrorClass(error));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
}

export function monotonicNow() {
  return performance.now();
}

export function elapsedMilliseconds(startedAt: number) {
  return safeBoundedNumber(performance.now() - startedAt, MAX_DURATION_MS, 2) ??
    0;
}
