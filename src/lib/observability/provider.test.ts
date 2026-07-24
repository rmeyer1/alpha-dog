import { describe, expect, it, vi } from "vitest";
import {
  observeProviderCall,
  providerHttpError,
  providerMalformedResponse,
  providerNames,
} from "./provider";

function records(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map(([value]) => String(value))
    .filter((value) => value.includes('"event":"provider.request"'))
    .map((value) => JSON.parse(value));
}

describe("provider telemetry matrix", () => {
  it.each(providerNames)(
    "%s records success, HTTP, timeout, malformed, and network outcomes",
    async (provider) => {
      const info = vi.spyOn(console, "info").mockImplementation(() => {});
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cases = [
        ["success", async () => "ok"],
        ["http_error", async () => {
          throw providerHttpError(503, "raw provider body canary");
        }],
        ["timeout", async () => {
          throw new DOMException("timeout canary", "TimeoutError");
        }],
        ["malformed_response", async () => {
          throw providerMalformedResponse("malformed body canary");
        }],
        ["network_error", async () => {
          throw new TypeError("network URL canary");
        }],
      ] as const;

      for (const [, callback] of cases) {
        await observeProviderCall(provider, "controlled_probe", callback)
          .catch(() => undefined);
      }

      const observed = [...records(info), ...records(warn)]
        .filter((record) => record.provider === provider)
        .map((record) => record.outcome)
        .sort();

      expect(observed).toEqual(
        cases.map(([outcome]) => outcome).sort(),
      );
      const serialized = JSON.stringify([
        ...info.mock.calls,
        ...warn.mock.calls,
      ]);
      expect(serialized).not.toContain("raw provider body canary");
      expect(serialized).not.toContain("timeout canary");
      expect(serialized).not.toContain("malformed body canary");
      expect(serialized).not.toContain("network URL canary");

      info.mockRestore();
      warn.mockRestore();
    },
  );
});
