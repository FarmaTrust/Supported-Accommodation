import { describe, expect, it } from "vitest";
import { getAuthFeedback, isAuthFeedbackCode } from "@shared/authFeedback";

describe("auth feedback catalogue", () => {
  it("maps recognised sign-in codes to plain-English feedback without provider internals", () => {
    const feedback = getAuthFeedback("AUTH_PROVIDER_REJECTED");
    expect(feedback.title).toBe("Sign-in was not accepted");
    expect(feedback.message).not.toMatch(/password|stack|token/i);
    expect(feedback.code).toBe("AUTH_PROVIDER_REJECTED");
  });

  it("accepts only stable public codes", () => {
    expect(isAuthFeedbackCode("AUTH_ACCESS_DENIED")).toBe(true);
    expect(isAuthFeedbackCode("invalid oauth state")).toBe(false);
  });
});
