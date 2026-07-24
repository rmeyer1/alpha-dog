import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AccountPaginationError,
  createEventCursor,
  createPositionCursor,
  CURSOR_MAX_AGE_MS,
  MAX_CURSOR_ENCODED_BYTES,
  parseEventCursor,
  parsePageSize,
  parsePositionCursor,
  parsePositionScope,
} from "./pagination";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherOwnerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const positionId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const now = Date.UTC(2026, 6, 24, 12);
const sortAt = "2026-07-24T11:00:00.000Z";
const watermark = "2026-07-24T11:45:00.000Z";
const cursorSecret = "test-account-pagination-secret-at-least-32-bytes";

function encodeSigned(value: unknown) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const signature = createHmac("sha256", cursorSecret)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function positionCursor(
  overrides: Partial<Parameters<typeof createPositionCursor>[0]> = {},
) {
  return createPositionCursor({
    id: positionId,
    ownerId,
    scope: "open",
    sortAt,
    watermark,
    ...overrides,
  }, now, cursorSecret);
}

describe("account pagination cursors", () => {
  it("round-trips position and position-bound event cursors", () => {
    const encodedPosition = positionCursor();
    const encodedEvent = createEventCursor({
      id: eventId,
      ownerId,
      positionId,
      sortAt,
    }, now, cursorSecret);

    expect(encodedPosition).not.toContain(sortAt);
    expect(parsePositionCursor(
      encodedPosition,
      "open",
      ownerId,
      now,
      cursorSecret,
    ))
      .toMatchObject({
        id: positionId,
        ownerId,
        scope: "open",
        watermark,
      });
    expect(parseEventCursor(
      encodedEvent,
      positionId,
      ownerId,
      now,
      cursorSecret,
    ))
      .toMatchObject({
        id: eventId,
        ownerId,
        positionId,
      });
  });

  it("rejects malformed, non-canonical, oversized, and unknown-field cursors", () => {
    expect(() =>
      parsePositionCursor("not+base64", "open", ownerId, now, cursorSecret)
    )
      .toThrowError(AccountPaginationError);
    expect(() =>
      parsePositionCursor(
        "A".repeat(MAX_CURSOR_ENCODED_BYTES + 1),
        "open",
        ownerId,
        now,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION_CURSOR" }));

    const raw = {
      expiresAt: now + CURSOR_MAX_AGE_MS,
      extra: true,
      id: positionId,
      issuedAt: now,
      kind: "positions",
      ownerId,
      scope: "open",
      sortAt,
      v: 1,
      watermark,
    };
    const withUnknownField = encodeSigned(raw);

    expect(() =>
      parsePositionCursor(
        withUnknownField,
        "open",
        ownerId,
        now,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION_CURSOR" }));
  });

  it("rejects wrong collection, position, and owner before accepting cursor state", () => {
    const encodedPosition = positionCursor();
    const encodedEvent = createEventCursor({
      id: eventId,
      ownerId,
      positionId,
      sortAt,
    }, now, cursorSecret);

    expect(() =>
      parsePositionCursor(
        encodedPosition,
        "history",
        ownerId,
        now,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION_CURSOR" }));
    expect(() =>
      parsePositionCursor(
        encodedPosition,
        "open",
        otherOwnerId,
        now,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION_CURSOR" }));
    expect(() =>
      parseEventCursor(
        encodedEvent,
        crypto.randomUUID(),
        ownerId,
        now,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT_CURSOR" }));
    expect(() =>
      parseEventCursor(
        encodedEvent,
        positionId,
        otherOwnerId,
        now,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_EVENT_CURSOR" }));
  });

  it("returns explicit stale errors for expired position and event cursors", () => {
    const issuedAt = now - CURSOR_MAX_AGE_MS - 1;
    const encodedPosition = createPositionCursor({
      id: positionId,
      ownerId,
      scope: "open",
      sortAt,
      watermark,
    }, issuedAt, cursorSecret);
    const encodedEvent = createEventCursor({
      id: eventId,
      ownerId,
      positionId,
      sortAt,
    }, issuedAt, cursorSecret);

    expect(() =>
      parsePositionCursor(
        encodedPosition,
        "open",
        ownerId,
        now,
        cursorSecret,
      )
    ).toThrowError(
      expect.objectContaining({ code: "STALE_POSITION_CURSOR", status: 409 }),
    );
    expect(() =>
      parseEventCursor(
        encodedEvent,
        positionId,
        ownerId,
        now,
        cursorSecret,
      )
    ).toThrowError(
      expect.objectContaining({ code: "STALE_EVENT_CURSOR", status: 409 }),
    );
  });

  it("rejects a forged expiry window and far-future issue time", () => {
    const [payload, signature] = positionCursor().split(".");
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    parsed.expiresAt = now + CURSOR_MAX_AGE_MS * 2;
    const forgedPayload = Buffer.from(JSON.stringify(parsed)).toString("base64url");
    const forgedExpiry = `${forgedPayload}.${signature}`;

    expect(() =>
      parsePositionCursor(
        forgedExpiry,
        "open",
        ownerId,
        now,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION_CURSOR" }));

    const future = positionCursor();
    expect(() =>
      parsePositionCursor(
        future,
        "open",
        ownerId,
        now - 60_001,
        cursorSecret,
      )
    ).toThrowError(expect.objectContaining({ code: "INVALID_POSITION_CURSOR" }));
  });

  it("enforces practical page-size and scope limits", () => {
    expect(parsePageSize(null, { defaultSize: 25, maxSize: 100 })).toBe(25);
    expect(parsePageSize("100", { defaultSize: 25, maxSize: 100 })).toBe(100);
    expect(() => parsePageSize("0", { defaultSize: 25, maxSize: 100 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PAGE_SIZE" }));
    expect(() => parsePageSize("101", { defaultSize: 25, maxSize: 100 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PAGE_SIZE" }));
    expect(() => parsePageSize("2.5", { defaultSize: 25, maxSize: 100 }))
      .toThrowError(expect.objectContaining({ code: "INVALID_PAGE_SIZE" }));
    expect(parsePositionScope(null)).toBe("both");
    expect(parsePositionScope("history")).toBe("history");
    expect(() => parsePositionScope("everything")).toThrowError(
      expect.objectContaining({ code: "INVALID_POSITION_SCOPE" }),
    );
  });
});
