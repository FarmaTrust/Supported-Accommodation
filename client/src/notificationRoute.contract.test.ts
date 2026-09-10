import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const dashboardSource = readFileSync(new URL("client/src/components/DashboardLayout.tsx", root), "utf8");
const searchSource = readFileSync(new URL("client/src/pages/Search.tsx", root), "utf8");
const workspaceSource = readFileSync(new URL("server/routers/workspace.ts", root), "utf8");

describe("staff-request outcome notification surface", () => {
  it("shows a current-user unread indicator and opens the notification panel directly", () => {
    expect(dashboardSource).toContain("trpc.workspace.notifications.useQuery");
    expect(dashboardSource).toContain("/search?tab=notifications");
    expect(searchSource).toContain("notificationTabFromSearch(window.location.search)");
    expect(searchSource).toContain('type === "staff_request_outcome" ? "/staff"');
  });

  it("retains current-user ownership checks when listing and marking notifications read", () => {
    expect(workspaceSource).toContain("eq(notifications.userId, ctx.user.id)");
    expect(workspaceSource).toContain("markNotificationRead");
    expect(workspaceSource).toContain("where(and(eq(notifications.id, input.id), eq(notifications.userId, ctx.user.id)))");
  });
});
