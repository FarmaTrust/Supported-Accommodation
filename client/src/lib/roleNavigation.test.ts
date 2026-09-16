import { describe, expect, it } from "vitest";
import { canViewWorkspaceNavigation, visibleWorkspacePaths } from "./roleNavigation";

describe("role-aware workspace navigation", () => {
  it("keeps finance focused on finance, property, compliance and authorised documents", () => {
    expect(canViewWorkspaceNavigation("finance", "/finance")).toBe(true);
    expect(canViewWorkspaceNavigation("finance", "/compliance")).toBe(true);
    expect(canViewWorkspaceNavigation("finance", "/placements")).toBe(false);
    expect(canViewWorkspaceNavigation("finance", "/safeguarding")).toBe(false);
    expect(canViewWorkspaceNavigation("finance", "/access-control")).toBe(false);
  });

  it("keeps Key Worker navigation within frontline and assigned-record workflows", () => {
    expect(canViewWorkspaceNavigation("support_worker", "/keyworker-app")).toBe(true);
    expect(canViewWorkspaceNavigation("support_worker", "/placements")).toBe(true);
    expect(canViewWorkspaceNavigation("support_worker", "/finance")).toBe(false);
    expect(canViewWorkspaceNavigation("support_worker", "/workforce")).toBe(false);
    expect(canViewWorkspaceNavigation("support_worker", "/access-control")).toBe(false);
  });

  it("keeps manager operational work visible without company access-control settings", () => {
    expect(canViewWorkspaceNavigation("registered_manager", "/manager-app")).toBe(true);
    expect(canViewWorkspaceNavigation("registered_manager", "/finance")).toBe(true);
    expect(canViewWorkspaceNavigation("registered_manager", "/access-control")).toBe(false);
  });

  it("retains the established full operational navigation for owners and TEST platform administrators", () => {
    expect(visibleWorkspacePaths("owner")).toContain("/access-control");
    expect(visibleWorkspacePaths("platform_admin")).toContain("/finance");
  });

  it("hides navigation for an unknown client role rather than guessing permissions", () => {
    expect(visibleWorkspacePaths("unknown")).toEqual([]);
  });
});
