import {
  context,
  createContextKey,
} from "@opentelemetry/api";
import type { DurableTelemetryContext } from "./durable-context";

export type { DurableTelemetryContext } from "./durable-context";

export const CORRELATION_HEADER = "x-alpha-dog-correlation-id";
export const MAX_CORRELATION_ID_LENGTH = 64;

const SAFE_CORRELATION_ID_PATTERN =
  /^(?=[A-Za-z0-9._:-]{1,64}$)(?=.*[0-9._:-])[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface TelemetryContext {
  correlationId: string;
  method?: string;
  route?: string;
}

const requestTelemetryContextKey = createContextKey(
  "alpha-dog.telemetry-context",
);

export function createCorrelationId() {
  return crypto.randomUUID();
}

export function normalizeCorrelationId(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CORRELATION_ID_LENGTH ||
    !SAFE_CORRELATION_ID_PATTERN.test(value)
  ) {
    return null;
  }

  return value;
}

export function correlationIdFromRequest(request?: Request | null) {
  return normalizeCorrelationId(
    request?.headers.get(CORRELATION_HEADER),
  ) ?? createCorrelationId();
}

export function runWithTelemetryContext<T>(
  telemetryContext: TelemetryContext,
  callback: () => T,
) {
  return context.with(
    context.active().setValue(
      requestTelemetryContextKey,
      telemetryContext,
    ),
    callback,
  );
}

export function activeTelemetryContext() {
  return (
    context.active().getValue(requestTelemetryContextKey) as
      | TelemetryContext
      | undefined
  ) ?? null;
}

export function createDurableTelemetryContext(
  correlationId = activeTelemetryContext()?.correlationId,
): DurableTelemetryContext {
  return {
    correlationId:
      normalizeCorrelationId(correlationId) ?? createCorrelationId(),
    logicalOperationId: crypto.randomUUID(),
  };
}

export function normalizeDurableTelemetryContext(
  value: DurableTelemetryContext | null | undefined,
): DurableTelemetryContext {
  return {
    correlationId:
      normalizeCorrelationId(value?.correlationId) ?? createCorrelationId(),
    logicalOperationId:
      normalizeCorrelationId(value?.logicalOperationId) ??
        crypto.randomUUID(),
  };
}
