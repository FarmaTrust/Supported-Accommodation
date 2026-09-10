import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectRoot = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, projectRoot), "utf8");

describe("Governance & outcomes route contract", () => {
  it("registers the governed workspace as a lazy application route", () => {
    const app = read("client/src/App.tsx");
    expect(app).toContain('const GovernanceHubPage = lazy(() => import("./pages/GovernanceHub"));');
    expect(app).toContain('<Route path={"/governance"} component={GovernanceHubPage} />');
  });

  it("exposes the governed workspace in persistent navigation", () => {
    const layout = read("client/src/components/DashboardLayout.tsx");
    expect(layout).toContain('{ icon: Scale, label: "Governance & outcomes", path: "/governance" }');
  });

  it("preserves explicit loading, denied, and empty states for restricted governance work", () => {
    const page = read("client/src/pages/GovernanceHub.tsx");
    expect(page).toContain('aria-label="Loading governance workspace"');
    expect(page).toContain('title="Governance workspace restricted"');
    expect(page).toContain('title="No data-rights cases"');
    expect(page).toContain('title="No framework records"');
    expect(page).toContain('title="No outcome measures"');
  });
});
