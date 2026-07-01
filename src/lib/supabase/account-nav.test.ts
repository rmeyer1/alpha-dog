import { describe, expect, it } from "vitest";
import { accountNavStateFromHubState } from "./account-nav";

describe("account nav state", () => {
  it("maps unauthenticated account hub state", () => {
    expect(accountNavStateFromHubState({ status: "unauthenticated" }))
      .toEqual({ status: "unauthenticated" });
  });

  it("maps incomplete profile account hub state", () => {
    expect(accountNavStateFromHubState({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: null,
      missingFields: ["last name"],
      status: "incomplete_profile",
      userId: "user-1",
    })).toEqual({
      email: "desk@example.com",
      missingFields: ["last name"],
      status: "incomplete_profile",
    });
  });

  it("maps ready account hub state to compact display data", () => {
    expect(accountNavStateFromHubState({
      email: "desk@example.com",
      firstName: "Ryan",
      identities: [],
      lastName: "Meyer",
      presetCount: 2,
      primaryProvider: "google",
      profileUpdatedAt: null,
      status: "ready",
      userId: "user-1",
    })).toEqual({
      displayName: "Ryan Meyer",
      email: "desk@example.com",
      status: "ready",
    });
  });
});
