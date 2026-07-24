import { describe, expect, it } from "vitest";
import {
  redactApiErrorResponse,
  redactSensitiveValue,
} from "./redaction";

const CANARIES = [
  "person@example.test",
  "Bearer authorization-canary",
  "cookie-canary",
  "service-role-key-canary",
  "0x1234567890abcdef",
  "statement-row-canary",
  "prompt-canary",
  "provider-body-canary",
  "https://internal.example.test/path?token=url-canary",
];

describe("recursive redaction", () => {
  it("removes sensitive keys and values from nested objects and arrays", () => {
    const value = redactSensitiveValue({
      error: {
        cause: new Error(CANARIES[7]),
        details: [
          {
            email: CANARIES[0],
            message: `${CANARIES[4]} ${CANARIES[8]}`,
            rows: [CANARIES[5]],
          },
        ],
        headers: {
          authorization: CANARIES[1],
          cookie: CANARIES[2],
        },
        key: CANARIES[3],
        message: `${CANARIES[6]} ${CANARIES[7]}`,
      },
    });
    const serialized = JSON.stringify(value);

    for (const canary of CANARIES) {
      expect(serialized).not.toContain(canary);
    }
  });

  it("sanitizes the final serialized API error while preserving safe fields", async () => {
    const response = await redactApiErrorResponse(Response.json({
      error: {
        code: "UPSTREAM_FAILED",
        details: { prompt: CANARIES[6] },
        message: `Provider failed: ${CANARIES[0]}`,
        retryable: true,
      },
    }, { status: 502 }));
    const serialized = await response.text();

    expect(response.status).toBe(502);
    expect(serialized).toContain("UPSTREAM_FAILED");
    expect(serialized).toContain('"retryable":true');
    for (const canary of CANARIES) {
      expect(serialized).not.toContain(canary);
    }
  });
});
