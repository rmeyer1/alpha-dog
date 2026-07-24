export interface DurableTelemetryContext {
  correlationId: string;
  logicalOperationId: string;
  startedAtEpochMs: number;
}

const SAFE_DURABLE_ID_PATTERN =
  /^(?=[A-Za-z0-9._:-]{1,64}$)(?=.*[0-9._:-])[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export function requireDurableTelemetryContext(
  value: DurableTelemetryContext,
) {
  if (
    !value ||
    !SAFE_DURABLE_ID_PATTERN.test(value.correlationId) ||
    !SAFE_DURABLE_ID_PATTERN.test(value.logicalOperationId) ||
    !Number.isSafeInteger(value.startedAtEpochMs) ||
    value.startedAtEpochMs <= 0
  ) {
    throw new Error("A valid durable telemetry context is required.");
  }

  return value;
}
