import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("compact dashboard card interactions", () => {
  it("renders reusable metric cards as compact horizontal actions when a destination is provided", () => {
    const source = read("client/src/components/app/Primitives.tsx");
    expect(source).toContain("onClick?: () => void");
    expect(source).toContain("min-h-[5.5rem]");
    expect(source).toContain("items-center gap-3");
    expect(source).toContain("aria-label={`Open ${label}`}");
  });

  it("routes the overview metrics and priority records to their relevant workspaces", () => {
    const source = read("client/src/pages/Home.tsx");
    expect(source).toContain('onClick={() => setLocation("/properties")}');
    expect(source).toContain('onClick={() => setLocation("/workforce")}');
    expect(source).toContain('onClick={() => setLocation("/placements")}');
    expect(source).toContain('onClick={() => setLocation("/search?tab=notifications")}');
    expect(source).toContain('item.kind === "incident" ? "/safeguarding"');
  });

  it("links manager summary cards to live queues and focuses the report-review section", () => {
    const source = read("client/src/pages/ManagerApp.tsx");
    expect(source).toContain('path: "/manager-app?section=reports"');
    expect(source).toContain('document.getElementById("submitted-reports")');
    expect(source).toContain("queue.isLoading || shifts.isLoading");
    expect(source).toContain('id="submitted-reports"');
    expect(source).toContain("onClick: () => void");
  });

  it("makes compliance summary cards compact, actionable and filterable", () => {
    const calendarSource = read("client/src/pages/Compliance.tsx");
    const dashboardSource = read("client/src/pages/ComplianceDashboard.tsx");
    expect(calendarSource).toContain("const visibleData");
    expect(calendarSource).toContain("aria-pressed={statusFilter === status}");
    expect(calendarSource).toContain("Filter calendar");
    expect(dashboardSource).toContain('setLocation("/compliance")');
    expect(dashboardSource).toContain("Open compliance calendar");
  });
});
