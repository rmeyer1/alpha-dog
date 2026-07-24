import { dispatchAlert } from "./alerts";
import { emitTelemetry } from "./telemetry";

export async function emitStatementImportTelemetry(options: {
  alert?: boolean;
  error?: unknown;
  errorCode?: string;
  operation?: "statement_import" | "statement_import_finalize";
  outcome: "failed" | "finalized" | "started";
}) {
  emitTelemetry({
    error: options.error,
    errorCode: options.errorCode,
    event: "statement_import.lifecycle",
    operation: options.operation ?? "statement_import",
    outcome: options.outcome,
    severity: options.outcome === "failed" ? "error" : "info",
  });

  if (options.alert) {
    if (options.outcome === "failed") {
      await dispatchAlert("import_finalization_failure", "triggered");
    } else if (options.outcome === "finalized") {
      await dispatchAlert("import_finalization_failure", "recovered");
    }
  }
}
