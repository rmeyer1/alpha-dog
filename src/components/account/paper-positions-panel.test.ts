import { describe, expect, it } from "vitest";
import {
  lifecycleLabel,
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
