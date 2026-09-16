import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("report completion status interfaces", () => {
  it("shows report state by property for a Key Worker without claiming an inferred expected schedule", () => {
    const source = read("client/src/pages/KeyWorkerApp.tsx");
    expect(source).toContain("trpc.keywork.reportCompletion.useQuery");
    expect(source).toContain("recorded report states only");
    expect(source).toContain("needs completion");
  });

  it("shows Manager oversight by Key Worker and property with an actionable report destination", () => {
    const source = read("client/src/pages/ManagerApp.tsx");
    expect(source).toContain("By Key Worker and property");
    expect(source).toContain('setLocation("/key-worker")');
    expect(source).toContain("worker.counts.logged");
  });
});
