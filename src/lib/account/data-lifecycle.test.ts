import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DATA_RETENTION_POLICY,
  ACCOUNT_DELETION_CONFIRMATION,
  ACCOUNT_DELETION_REAUTH_MINUTES,
  ACCOUNT_EXPORT_FORMAT,
  ACCOUNT_EXPORT_SCHEMA_VERSION,
  createAccountExportDocument,
  hasRecentAccountAuthentication,
  validAccountDeletionConfirmation,
} from "./data-lifecycle";

describe("account data lifecycle", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");

  it("requires recent authentication on the exact verified session", () => {
    const timestamp = Math.floor(now.getTime() / 1_000);
    const recentClaims = {
      amr: [{
        method: "password",
        timestamp: timestamp -
          ACCOUNT_DELETION_REAUTH_MINUTES * 60,
      }],
      sub: "user-1",
    };

    expect(hasRecentAccountAuthentication(
      recentClaims,
      "user-1",
      now,
    )).toBe(true);
    expect(hasRecentAccountAuthentication({
      ...recentClaims,
      amr: [{
        method: "password",
        timestamp: timestamp -
          ACCOUNT_DELETION_REAUTH_MINUTES * 60 -
          1,
      }],
    }, "user-1", now)).toBe(false);
    expect(hasRecentAccountAuthentication({
      ...recentClaims,
      amr: [{ method: "oauth", timestamp: timestamp + 1 }],
    }, "user-1", now)).toBe(false);
    expect(hasRecentAccountAuthentication(
      recentClaims,
      "other-user",
      now,
    )).toBe(false);
    expect(hasRecentAccountAuthentication({
      ...recentClaims,
      amr: [{ method: "token_refresh", timestamp }],
    }, "user-1", now)).toBe(false);
    expect(hasRecentAccountAuthentication({
      ...recentClaims,
      amr: [{ method: "anonymous", timestamp }],
    }, "user-1", now)).toBe(false);
    expect(hasRecentAccountAuthentication({
      ...recentClaims,
      amr: ["password"],
    }, "user-1", now)).toBe(false);
    expect(hasRecentAccountAuthentication({
      ...recentClaims,
      amr: [null],
    } as never, "user-1", now)).toBe(false);
    expect(hasRecentAccountAuthentication({
      amr: undefined,
      sub: "user-1",
    }, "user-1", now)).toBe(false);
  });

  it("requires the exact phrase and the signed-in account email", () => {
    expect(validAccountDeletionConfirmation({
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      email: " Desk@Example.com ",
    }, "desk@example.com")).toBe(true);
    expect(validAccountDeletionConfirmation({
      confirmation: "delete my account",
      email: "desk@example.com",
    }, "desk@example.com")).toBe(false);
    expect(validAccountDeletionConfirmation({
      confirmation: ACCOUNT_DELETION_CONFIRMATION,
      email: "other@example.com",
    }, "desk@example.com")).toBe(false);
  });

  it("wraps records in a versioned, timestamped export contract", () => {
    const document = createAccountExportDocument(
      "account-1",
      { presets: [{ id: "preset-1" }] },
      now,
    );

    expect(document).toEqual({
      accountId: "account-1",
      exportedAt: now.toISOString(),
      format: ACCOUNT_EXPORT_FORMAT,
      records: { presets: [{ id: "preset-1" }] },
      retentionPolicy: ACCOUNT_DATA_RETENTION_POLICY,
      schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    });
  });
});
