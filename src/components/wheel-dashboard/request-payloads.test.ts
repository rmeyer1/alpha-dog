import { describe, expect, it } from "vitest";
import {
  isApiErrorPayload,
  isScreenerRunResponse,
  responseErrorMessage,
} from "./request-payloads";

describe("request payload guards", () => {
  it("recognizes only API errors with a message", () => {
    expect(isApiErrorPayload({ error: { message: "No access" } })).toBe(true);
    expect(isApiErrorPayload({ error: {} })).toBe(false);
  });

  it("distinguishes asynchronous screener runs", () => {
    expect(isScreenerRunResponse({ runId: "run-1" } as never)).toBe(true);
    expect(isScreenerRunResponse({ companies: [] } as never)).toBe(false);
    expect(
      responseErrorMessage({ error: { message: "Bad request" } }, "Fallback"),
    ).toBe("Bad request");
  });
});
