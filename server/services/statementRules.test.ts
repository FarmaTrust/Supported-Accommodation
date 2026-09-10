import { describe, expect, it } from "vitest";
import { assertStatementRange, MAX_STATEMENT_RANGE_MS } from "./statementRules";

describe("statement date ranges", () => {
  it("allows a three-year selected range", () => expect(() => assertStatementRange(1_000, 1_000 + MAX_STATEMENT_RANGE_MS)).not.toThrow());
  it("rejects inverted and over-three-year ranges with corrective messages", () => {
    expect(() => assertStatementRange(3, 2)).toThrow("start date");
    expect(() => assertStatementRange(1, 1 + MAX_STATEMENT_RANGE_MS + 1)).toThrow("up to three years");
  });
});
