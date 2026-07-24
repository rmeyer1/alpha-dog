import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";

export const DEFAULT_POSITION_PAGE_SIZE = 25;
export const MAX_POSITION_PAGE_SIZE = 100;
export const DEFAULT_EVENT_PAGE_SIZE = 50;
export const MAX_EVENT_PAGE_SIZE = 100;
export const CURSOR_MAX_AGE_MS = 30 * 60 * 1_000;
export const MAX_CURSOR_ENCODED_BYTES = 2_048;
export const MAX_CURSOR_DECODED_BYTES = 1_024;

export const positionCollectionSchema = z.enum(["history", "open"]);
export type PositionCollection = z.infer<typeof positionCollectionSchema>;

const cursorBaseSchema = z.object({
  expiresAt: z.number().int().nonnegative(),
  id: z.string().uuid(),
  issuedAt: z.number().int().nonnegative(),
  ownerId: z.string().uuid(),
  sortAt: z.iso.datetime({ offset: true }),
  v: z.literal(1),
}).strict();

const positionCursorSchema = cursorBaseSchema.extend({
  kind: z.literal("positions"),
  scope: positionCollectionSchema,
  watermark: z.iso.datetime({ offset: true }),
}).strict();

const eventCursorSchema = cursorBaseSchema.extend({
  kind: z.literal("events"),
  positionId: z.string().uuid(),
}).strict();

export type PositionCursor = z.infer<typeof positionCursorSchema>;
export type EventCursor = z.infer<typeof eventCursorSchema>;

export type AccountPaginationErrorCode =
  | "INVALID_EVENT_CURSOR"
  | "INVALID_PAGE_SIZE"
  | "INVALID_POSITION_CURSOR"
  | "INVALID_POSITION_SCOPE"
  | "STALE_EVENT_CURSOR"
  | "STALE_POSITION_CURSOR";

export class AccountPaginationError extends Error {
  constructor(
    public readonly code: AccountPaginationErrorCode,
    message: string,
    public readonly status: 400 | 409,
  ) {
    super(message);
    this.name = "AccountPaginationError";
  }
}

const developmentCursorSecret = randomBytes(32).toString("base64url");

function cursorSigningSecret(override?: string) {
  if (override) {
    return override;
  }

  const env = getEnv();
  const configured = env.API_ABUSE_HMAC_SECRET ??
    env.ALPHA_DOG_SUPABASE_SERVICE_ROLE_KEY ??
    env.SUPABASE_SERVICE_ROLE_KEY;

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return developmentCursorSecret;
  }

  throw new Error("Account pagination cursor signing is not configured.");
}

function cursorSignature(payload: string, secret?: string) {
  return createHmac("sha256", cursorSigningSecret(secret))
    .update(payload)
    .digest("base64url");
}

function encodeCursor(
  value: PositionCursor | EventCursor,
  secret?: string,
) {
  const payload = Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64url");

  return `${payload}.${cursorSignature(payload, secret)}`;
}

function cursorError(
  kind: "events" | "positions",
  status: 400 | 409 = 400,
) {
  const isStale = status === 409;

  return new AccountPaginationError(
    kind === "events"
      ? isStale
        ? "STALE_EVENT_CURSOR"
        : "INVALID_EVENT_CURSOR"
      : isStale
        ? "STALE_POSITION_CURSOR"
        : "INVALID_POSITION_CURSOR",
    isStale
      ? kind === "events"
        ? "The event cursor has expired. Reopen the position detail."
        : "The position list changed or its cursor expired. Refresh the position list."
      : kind === "events"
        ? "The event pagination cursor is invalid."
        : "The position pagination cursor is invalid.",
    status,
  );
}

function decodeCursorValue(
  value: string,
  kind: "events" | "positions",
  secret?: string,
) {
  if (
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > MAX_CURSOR_ENCODED_BYTES ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw cursorError(kind);
  }

  const [payload, encodedSignature] = value.split(".");
  const decoded = Buffer.from(payload, "base64url");
  const signature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = Buffer.from(
    cursorSignature(payload, secret),
    "base64url",
  );

  if (
    decoded.byteLength === 0 ||
    decoded.byteLength > MAX_CURSOR_DECODED_BYTES ||
    decoded.toString("base64url") !== payload ||
    signature.byteLength !== expectedSignature.byteLength ||
    !timingSafeEqual(signature, expectedSignature)
  ) {
    throw cursorError(kind);
  }

  try {
    return JSON.parse(decoded.toString("utf8")) as unknown;
  } catch {
    throw cursorError(kind);
  }
}

function assertCursorAge(
  cursor: { expiresAt: number; issuedAt: number },
  kind: "events" | "positions",
  now: number,
) {
  if (
    cursor.issuedAt > now + 60_000 ||
    cursor.expiresAt !== cursor.issuedAt + CURSOR_MAX_AGE_MS
  ) {
    throw cursorError(kind);
  }

  if (now > cursor.expiresAt) {
    throw cursorError(kind, 409);
  }
}

export function createPositionCursor(
  input: Omit<
    PositionCursor,
    "expiresAt" | "issuedAt" | "kind" | "v"
  >,
  now = Date.now(),
  secret?: string,
) {
  return encodeCursor({
    ...input,
    expiresAt: now + CURSOR_MAX_AGE_MS,
    issuedAt: now,
    kind: "positions",
    v: 1,
  }, secret);
}

export function createEventCursor(
  input: Omit<EventCursor, "expiresAt" | "issuedAt" | "kind" | "v">,
  now = Date.now(),
  secret?: string,
) {
  return encodeCursor({
    ...input,
    expiresAt: now + CURSOR_MAX_AGE_MS,
    issuedAt: now,
    kind: "events",
    v: 1,
  }, secret);
}

export function parsePositionCursor(
  value: string | null,
  scope: PositionCollection,
  ownerId: string,
  now = Date.now(),
  secret?: string,
) {
  if (!value) {
    return null;
  }

  try {
    const parsed = positionCursorSchema.parse(
      decodeCursorValue(value, "positions", secret),
    );

    if (parsed.scope !== scope || parsed.ownerId !== ownerId) {
      throw cursorError("positions");
    }

    assertCursorAge(parsed, "positions", now);
    return parsed;
  } catch (error) {
    if (error instanceof AccountPaginationError) {
      throw error;
    }

    throw cursorError("positions");
  }
}

export function parseEventCursor(
  value: string | null,
  positionId: string,
  ownerId: string,
  now = Date.now(),
  secret?: string,
) {
  if (!value) {
    return null;
  }

  try {
    const parsed = eventCursorSchema.parse(
      decodeCursorValue(value, "events", secret),
    );

    if (parsed.positionId !== positionId || parsed.ownerId !== ownerId) {
      throw cursorError("events");
    }

    assertCursorAge(parsed, "events", now);
    return parsed;
  } catch (error) {
    if (error instanceof AccountPaginationError) {
      throw error;
    }

    throw cursorError("events");
  }
}

export function parsePageSize(
  value: string | null,
  defaults: { defaultSize: number; maxSize: number },
) {
  if (value == null || value === "") {
    return defaults.defaultSize;
  }

  if (!/^\d+$/.test(value)) {
    throw new AccountPaginationError(
      "INVALID_PAGE_SIZE",
      `Page size must be a whole number from 1 to ${defaults.maxSize}.`,
      400,
    );
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > defaults.maxSize) {
    throw new AccountPaginationError(
      "INVALID_PAGE_SIZE",
      `Page size must be a whole number from 1 to ${defaults.maxSize}.`,
      400,
    );
  }

  return parsed;
}

export function parsePositionScope(value: string | null) {
  if (value == null || value === "" || value === "both") {
    return "both" as const;
  }

  const parsed = positionCollectionSchema.safeParse(value);

  if (!parsed.success) {
    throw new AccountPaginationError(
      "INVALID_POSITION_SCOPE",
      "Position scope must be open, history, or both.",
      400,
    );
  }

  return parsed.data;
}
