import { describe, expect, it } from "vitest";
import { dataRightsTransitionAllowed, independentlyApprovedBy, regimeTransitionAllowed, validObservationPeriod } from "./governanceRules";

describe("governance workflow rules", () => {
  it("allows only explicit data-rights lifecycle transitions", () => {
    expect(dataRightsTransitionAllowed("identity_check", "scoping")).toBe(true);
    expect(dataRightsTransitionAllowed("collecting", "awaiting_approval")).toBe(true);
    expect(dataRightsTransitionAllowed("ready", "delivered")).toBe(true);
    expect(dataRightsTransitionAllowed("delivered", "collecting")).toBe(false);
    expect(dataRightsTransitionAllowed("draft" as never, "ready")).toBe(false);
  });

  it("requires review and activation to be independent of recorded authors", () => {
    expect(independentlyApprovedBy(7, [4, 5])).toBe(true);
    expect(independentlyApprovedBy(7, [7, 5])).toBe(false);
    expect(independentlyApprovedBy(7, [4, 7])).toBe(false);
  });

  it("allows only controlled regulatory regime progression", () => {
    expect(regimeTransitionAllowed("draft", "in_review")).toBe(true);
    expect(regimeTransitionAllowed("in_review", "approved")).toBe(true);
    expect(regimeTransitionAllowed("approved", "active")).toBe(true);
    expect(regimeTransitionAllowed("draft", "active")).toBe(false);
  });

  it("rejects zero-length and reversed outcomes periods", () => {
    expect(validObservationPeriod(10, 11)).toBe(true);
    expect(validObservationPeriod(10, 10)).toBe(false);
    expect(validObservationPeriod(11, 10)).toBe(false);
  });
});

