import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_CORRELATION_HEADER,
  authCorrelationIdFromRequest,
  logAuthAccountFailure,
  safeAuthLogCode,
} from "./auth-observability";

describe("auth observability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses caller supplied correlation ids", () => {
    const request = new Request("https://alpha.example", {
      headers: {
        [AUTH_CORRELATION_HEADER]: "qa-correlation-id",
      },
    });

    expect(authCorrelationIdFromRequest(request)).toBe("qa-correlation-id");
  });

  it("generates correlation ids when none are supplied", () => {
    expect(authCorrelationIdFromRequest(new Request("https://alpha.example")))
      .toMatch(/^[0-9a-f-]{36}$/);
  });

  it("scrubs unexpected error codes before logging", () => {
    expect(safeAuthLogCode("ACCOUNT_EMAIL_CONFLICT")).toBe("ACCOUNT_EMAIL_CONFLICT");
    expect(safeAuthLogCode("token=secret")).toBe("UNKNOWN");
  });

  it("logs safe auth failure metadata without tokens or email addresses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logAuthAccountFailure({
      code: "ACCOUNT_PROFILE_CREATE_FAILED",
      correlationId: "correlation-1",
      operation: "manual_account",
      provider: "google",
    });

    expect(warn).toHaveBeenCalledWith("alpha_dog_auth_account_failure", {
      code: "ACCOUNT_PROFILE_CREATE_FAILED",
      correlationId: "correlation-1",
      operation: "manual_account",
      provider: "google",
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("@");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("token");
  });

  it("scrubs unexpected provider values before logging", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    logAuthAccountFailure({
      code: "ACCOUNT_EMAIL_CONFLICT",
      correlationId: "correlation-1",
      operation: "oauth_callback",
      provider: "google access_token=secret",
    });

    expect(warn).toHaveBeenCalledWith("alpha_dog_auth_account_failure", {
      code: "ACCOUNT_EMAIL_CONFLICT",
      correlationId: "correlation-1",
      operation: "oauth_callback",
      provider: "unknown",
    });
  });
});
