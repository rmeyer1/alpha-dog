import { describe, expect, it } from "vitest";
import {
  lifecycleLabel,
  lifecycleRows,
  validateClosePositionInput,
} from "./paper-positions-panel";

const assignedLifecycle = {
  cashDelta: -38_000,
  effectiveAt: "2026-08-21T21:00:00.000Z",
  eventId: "event-1",
  eventType: "assigned",
  marginDelta: 28_000,
  metadata: {
    assignmentCost: 38_000,
    costBasis: 190,
    shares: 200,
    underlyingPriceAtExpiration: 180,
  },
  outcome: "assigned" as const,
  price: 190,
  quantity: 2,
  realizedPnlDelta: 250,
};

describe("lifecycleLabel", () => {
  it("uses lifecycle outcome labels before raw status labels", () => {
    expect(lifecycleLabel("closed", {
      ...assignedLifecycle,
      outcome: "expired_otm",
    })).toBe("Expired OTM");
    expect(lifecycleLabel("closed", assignedLifecycle)).toBe("Assigned");
    expect(lifecycleLabel("called_away", {
      ...assignedLifecycle,
      eventType: "called_away",
      outcome: "called_away",
    })).toBe("Called away");
    expect(lifecycleLabel("manual_review", {
      ...assignedLifecycle,
      eventType: "manual_adjustment",
      outcome: "manual_review",
    })).toBe("Manual review");
  });

  it("falls back to readable status labels without lifecycle context", () => {
    expect(lifecycleLabel("partially_closed")).toBe("Partially Closed");
    expect(lifecycleLabel("closed")).toBe("Closed");
  });
});

describe("lifecycleRows", () => {
  it("exposes called-away backend metadata and fallbacks without local inference", () => {
    expect(lifecycleRows({
      cashDelta: 42_000,
      effectiveAt: "2026-08-21T21:00:00.000Z",
      eventId: "event-2",
      eventType: "called_away",
      marginDelta: 0,
      metadata: {
        calledAwayPrice: 210,
        calledAwayProceeds: 42_000,
        costBasis: 180,
        remainingLotShares: 100,
        shares: 200,
        sourceLotId: "lot-1",
        sourcePositionId: "assigned-put-position-1",
        underlyingPriceAtExpiration: 220,
      },
      outcome: "called_away",
      price: 210,
      quantity: 2,
      realizedPnlDelta: 6_500,
    })).toEqual([
      ["Effective date", "Aug 21, 2026"],
      ["Shares called away", "200"],
      ["Call-away price", "$210.00"],
      ["Call-away proceeds", "$42,000.00"],
      ["Cost basis", "$180.00"],
      ["Cash impact", "$42,000.00"],
      ["Realized P/L", "$6,500.00"],
      ["Underlying at expiration", "$220.00"],
      ["Source lot", "lot-1"],
      ["Source position", "assigned-put-position-1"],
      ["Remaining lot shares", "100"],
    ]);
  });

  it("keeps called-away rows readable when optional metadata is missing", () => {
    expect(lifecycleRows({
      cashDelta: 42_000,
      effectiveAt: "2026-08-21T21:00:00.000Z",
      eventId: "event-2",
      eventType: "called_away",
      marginDelta: 0,
      metadata: {},
      outcome: "called_away",
      price: 210,
      quantity: 2,
      realizedPnlDelta: 500,
    })).toContainEqual(["Source lot", "Unavailable"]);
  });
});

describe("validateClosePositionInput", () => {
  const validInput = {
    closedAt: "2026-07-05",
    closePrice: "0.65",
    contracts: "1",
    remainingContracts: 2,
  };

  it("accepts a positive whole quantity within the remaining contracts", () => {
    expect(validateClosePositionInput(validInput)).toEqual({ valid: true });
  });

  it("rejects invalid quantities and prices with production messages", () => {
    expect(validateClosePositionInput({
      ...validInput,
      contracts: "0",
    })).toEqual({
      message: "Contracts bought back must be a whole number above zero.",
      valid: false,
    });
    expect(validateClosePositionInput({
      ...validInput,
      closePrice: "-0.01",
    })).toEqual({
      message: "Buyback price must be zero or greater.",
      valid: false,
    });
  });

  it("marks over-close attempts as stale so the UI can prompt refresh", () => {
    expect(validateClosePositionInput({
      ...validInput,
      contracts: "3",
    })).toEqual({
      message: "Contracts bought back cannot exceed the remaining quantity.",
      stale: true,
      valid: false,
    });
  });

  it("requires a close date for the lifecycle event", () => {
    expect(validateClosePositionInput({
      ...validInput,
      closedAt: "",
    })).toEqual({
      message: "Close date is required.",
      valid: false,
    });
  });
});
