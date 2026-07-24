import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAlertStateForTests } from "./alerts";
import { observeCronOperation } from "./cron";
import { emitStatementImportTelemetry } from "./import";

beforeEach(() => {
  resetAlertStateForTests();
});

describe("operational failure paths", () => {
  it("emits a native runtime alert event for a controlled cron failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await observeCronOperation(
      "screener_refresh",
      async () => Response.json({ error: { code: "FAILED" } }, { status: 503 }),
    );
    const serialized = error.mock.calls.flat().join("\n");

    expect(response.status).toBe(503);
    expect(serialized).toContain('"event":"cron.execution"');
    expect(serialized).toContain('"alertKey":"cron_refresh_missing"');
    expect(serialized).toContain('"event":"alert.event"');

    error.mockRestore();
  });

  it("emits a native runtime alert event for import finalization failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await emitStatementImportTelemetry({
      alert: true,
      error: new Error("statement row secret canary"),
      errorCode: "IMPORT_WRITE_FAILED",
      operation: "statement_import_finalize",
      outcome: "failed",
    });
    const serialized = error.mock.calls.flat().join("\n");

    expect(serialized).toContain('"event":"statement_import.lifecycle"');
    expect(serialized).toContain(
      '"alertKey":"import_finalization_failure"',
    );
    expect(serialized).toContain('"event":"alert.event"');
    expect(serialized).not.toContain("statement row secret canary");

    error.mockRestore();
  });
});
