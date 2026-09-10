import { describe, expect, it } from "vitest";
import { governanceTabFromSearch } from "./GovernanceHub";

describe("governance tab deep links", () => {
  it("accepts the three declared governed workspace tabs", () => {
    expect(governanceTabFromSearch("?tab=rights")).toBe("rights");
    expect(governanceTabFromSearch("?tab=frameworks")).toBe("frameworks");
    expect(governanceTabFromSearch("?tab=outcomes")).toBe("outcomes");
  });

  it("falls back to information rights for missing or invalid tab input", () => {
    expect(governanceTabFromSearch("")).toBe("rights");
    expect(governanceTabFromSearch("?tab=unknown")).toBe("rights");
  });
});

