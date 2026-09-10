import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const appSource = readFileSync(new URL("client/src/App.tsx", root), "utf8");
const navigationSource = readFileSync(new URL("client/src/components/DashboardLayout.tsx", root), "utf8");
const pageSource = readFileSync(new URL("client/src/pages/StaffWorkspace.tsx", root), "utf8");

describe("staff workspace route", () => {
  it("registers the Staff workspace with a backward-compatible staff-app alias", () => {
    expect(appSource).toContain('const StaffWorkspacePage = lazy(() => import("./pages/StaffWorkspace"))');
    expect(appSource).toContain('<Route path={"/staff"} component={StaffWorkspacePage} />');
    expect(appSource).toContain('<Route path={"/staff-app"} component={StaffWorkspacePage} />');
    expect(navigationSource).toContain('{ icon: UserRound, label: "Staff workspace", path: "/staff" }');
  });

  it("uses the established self-service contracts and retains safe no-profile and restricted states", () => {
    expect(pageSource).toContain("trpc.staffWorkspace.context.useQuery");
    expect(pageSource).toContain("trpc.staffWorkspace.staffWorkspace.useQuery");
    expect(pageSource).toContain("trpc.staffWorkspace.submitStaffRequest.useMutation");
    expect(pageSource).toContain("Staff workspace restricted");
    expect(pageSource).toContain("staffWorkspaceRestrictedMessage");
    expect(pageSource).not.toContain("description={(context.error ?? workspace.error)?.message");
    expect(pageSource).toContain("No staff profile is linked");
    expect(pageSource).toContain('aria-label="Loading staff workspace"');
  });
});
