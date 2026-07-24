import { beforeEach, describe, expect, it, vi } from "vitest";

const scheduleAlertSample = vi.hoisted(() => vi.fn(() => true));
vi.mock("./alert-control-plane", () => ({
  scheduleAlertSample,
}));

import { observeCronOperation } from "./cron";
import { emitStatementImportTelemetry } from "./import";

describe("operational failure paths", () => {
  beforeEach(() => {
    scheduleAlertSample.mockClear();
  });

  it("records cron recovery after a controlled success", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await observeCronOperation(
      "screener_refresh",
      async () => Response.json({ ok: true }),
    );
    const serialized = info.mock.calls.flat().join("\n");

    expect(response.status).toBe(200);
    expect(serialized).toContain('"event":"cron.execution"');
    expect(scheduleAlertSample).toHaveBeenCalledWith(
      "cron_refresh_missing",
      0,
    );

    info.mockRestore();
  });

  it("emits a native runtime alert event for a controlled cron failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await observeCronOperation(
      "screener_refresh",
      async () => Response.json({ error: { code: "FAILED" } }, { status: 503 }),
    );
    const serialized = error.mock.calls.flat().join("\n");

    expect(response.status).toBe(503);
    expect(serialized).toContain('"event":"cron.execution"');
    expect(scheduleAlertSample).toHaveBeenCalledWith(
      "cron_refresh_missing",
      1,
    );

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
    expect(scheduleAlertSample).toHaveBeenCalledWith(
      "import_finalization_failure",
      1,
    );
    expect(serialized).not.toContain("statement row secret canary");

    error.mockRestore();
  });

  it("contains thrown cron details while preserving a durable failure signal", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      observeCronOperation("screener_refresh", async () => {
        throw new Error("cron payload secret canary");
      }),
    ).rejects.toThrow("cron payload secret canary");

    const serialized = error.mock.calls.flat().join("\n");

    expect(serialized).toContain('"event":"cron.execution"');
    expect(scheduleAlertSample).toHaveBeenCalledWith(
      "cron_refresh_missing",
      1,
    );
    expect(serialized).not.toContain("cron payload secret canary");

    error.mockRestore();
  });
});
