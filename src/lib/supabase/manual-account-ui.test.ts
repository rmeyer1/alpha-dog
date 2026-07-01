import { describe, expect, it } from "vitest";
import {
  manualAccountConflictPath,
  manualAccountCreatePath,
  manualAccountErrorsFromPayload,
  manualAccountRedirectTo,
  validateManualAccountFields,
} from "./manual-account-ui";

describe("manual account UI helpers", () => {
  it("validates client-detectable manual account field errors", () => {
    expect(validateManualAccountFields({
      email: "not-an-email",
      firstName: "",
      lastName: " ",
    })).toEqual({
      email: "Enter a valid email address.",
      firstName: "First name is required.",
      lastName: "Last name is required.",
    });
  });

  it("accepts valid manual account fields", () => {
    expect(validateManualAccountFields({
      email: "desk@example.com",
      firstName: "Ryan",
      lastName: "Meyer",
    })).toEqual({});
  });

  it("builds safe conflict and invite redirect destinations", () => {
    expect(manualAccountConflictPath("/screeners"))
      .toBe("/account?auth_error=EMAIL_ALREADY_REGISTERED&next=%2Fscreeners");
    expect(manualAccountConflictPath("https://evil.example"))
      .toBe("/account?auth_error=EMAIL_ALREADY_REGISTERED&next=%2Faccount");
    expect(manualAccountCreatePath("/screeners"))
      .toBe("/account/manual?next=%2Fscreeners");
    expect(manualAccountCreatePath("https://evil.example"))
      .toBe("/account/manual?next=%2Faccount");
    expect(manualAccountRedirectTo("https://alpha.example", "/screeners"))
      .toBe("https://alpha.example/account?profile=complete&next=%2Fscreeners");
  });

  it("maps backend validation payloads to field errors", () => {
    expect(manualAccountErrorsFromPayload({
      error: {
        code: "INVALID_MANUAL_ACCOUNT",
        details: {
          fieldErrors: {
            email: ["Invalid email address."],
            firstName: ["First name is required."],
          },
        },
        message: "Manual account payload is invalid.",
      },
    })).toEqual({
      conflict: false,
      fieldErrors: {
        email: "Invalid email address.",
        firstName: "First name is required.",
        lastName: undefined,
      },
      formError: null,
    });
  });

  it("maps duplicate email and generic backend errors", () => {
    expect(manualAccountErrorsFromPayload({
      error: {
        code: "EMAIL_ALREADY_REGISTERED",
        message: "An account already exists for this email.",
      },
    })).toEqual({
      conflict: true,
      fieldErrors: {
        email: undefined,
        firstName: undefined,
        lastName: undefined,
      },
      formError: "An account already exists for this email.",
    });
  });
});
