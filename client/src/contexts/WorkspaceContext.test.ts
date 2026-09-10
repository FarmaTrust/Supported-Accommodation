import { describe, expect, it } from "vitest";
import { initialWorkspaceEntityId, parseWorkspaceEntityId } from "./WorkspaceContext";

describe("workspace entity deep links", () => {
  it("accepts only safe positive entity identifiers", () => {
    expect(parseWorkspaceEntityId("30001")).toBe(30001);
    expect(parseWorkspaceEntityId("0")).toBeNull();
    expect(parseWorkspaceEntityId("3.14")).toBeNull();
    expect(parseWorkspaceEntityId("not-an-id")).toBeNull();
  });

  it("prefers a valid query entity over retained local selection", () => {
    expect(initialWorkspaceEntityId("1", "?entity=30001")).toBe(30001);
    expect(initialWorkspaceEntityId("1", "?entity=999999")).toBe(999999);
    expect(initialWorkspaceEntityId("1", "?entity=invalid")).toBe(1);
    expect(initialWorkspaceEntityId(null, "?entity=30001")).toBe(30001);
  });
});
