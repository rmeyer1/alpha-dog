import { dispatchAlert } from "./alerts";
import { emitTelemetry } from "./telemetry";

export async function observeCronOperation(
  operation: string,
  callback: () => Promise<Response>,
) {
  try {
    const response = await callback();
    const failed = response.status >= 500;

    emitTelemetry({
      errorCode: failed ? `HTTP_${response.status}` : undefined,
      event: "cron.execution",
      httpStatus: response.status,
      operation,
      outcome: failed ? "failed" : "completed",
      severity: failed ? "error" : "info",
    });

    if (failed) {
      await dispatchAlert("cron_refresh_missing", "triggered");
    } else {
      await dispatchAlert("cron_refresh_missing", "recovered");
    }

    return response;
  } catch (error) {
    emitTelemetry({
      error,
      errorCode: "CRON_EXECUTION_FAILED",
      event: "cron.execution",
      operation,
      outcome: "failed",
      severity: "error",
    });
    await dispatchAlert("cron_refresh_missing", "triggered");
    throw error;
  }
}
