import {
  context,
  createContextKey,
} from "@opentelemetry/api";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DurableTelemetryContext } from "./durable-context";

export type { DurableTelemetryContext } from "./durable-context";

export const CORRELATION_HEADER = "x-alpha-dog-correlation-id";
export const MAX_CORRELATION_ID_LENGTH = 64;

const SAFE_CORRELATION_ID_PATTERN =
  /^(?=[A-Za-z0-9._:-]{1,64}$)(?=.*[0-9._:-])[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export interface TelemetryContext {
  clientCorrelationId?: string;
  correlationId: string;
  method?: string;
  route?: string;
}

const requestTelemetryContextKey = createContextKey(
  "alpha-dog.telemetry-context",
);
const requestTelemetryStorage = new AsyncLocalStorage<TelemetryContext>();

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
  void request;
  return createCorrelationId();
}

export function clientCorrelationIdFromRequest(request?: Request | null) {
  return normalizeCorrelationId(
    request?.headers.get(CORRELATION_HEADER),
  );
}

export function runWithTelemetryContext<T>(
  telemetryContext: TelemetryContext,
  callback: () => T,
) {
  return requestTelemetryStorage.run(
    telemetryContext,
    () =>
      context.with(
        context.active().setValue(
          requestTelemetryContextKey,
          telemetryContext,
        ),
        callback,
      ),
  );
}

export function activeTelemetryContext() {
  return (
    requestTelemetryStorage.getStore() ??
    (
      context.active().getValue(requestTelemetryContextKey) as
        | TelemetryContext
        | undefined
    )
  ) ?? null;
}

export function createDurableTelemetryContext(
  correlationId = activeTelemetryContext()?.correlationId,
): DurableTelemetryContext {
  return {
    correlationId:
      normalizeCorrelationId(correlationId) ?? createCorrelationId(),
    logicalOperationId: crypto.randomUUID(),
    startedAtEpochMs: Date.now(),
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
    startedAtEpochMs:
      Number.isSafeInteger(value?.startedAtEpochMs) &&
        Number(value?.startedAtEpochMs) > 0
        ? Number(value?.startedAtEpochMs)
        : Date.now(),
  };
}
