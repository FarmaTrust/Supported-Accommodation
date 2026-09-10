import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const appSource = readFileSync(new URL("client/src/App.tsx", root), "utf8");
const navigationSource = readFileSync(new URL("client/src/components/DashboardLayout.tsx", root), "utf8");
const managerSource = readFileSync(new URL("client/src/pages/ManagerApp.tsx", root), "utf8");
const keyWorkerSource = readFileSync(new URL("client/src/pages/KeyWorkerApp.tsx", root), "utf8");
const keyworkRouterSource = readFileSync(new URL("server/routers/keywork.ts", root), "utf8");

describe("Manager and Key Worker mobile app entry points", () => {
  it("registers dedicated app routes and visible navigation entries", () => {
    expect(appSource).toContain('path={"/manager-app"}');
    expect(appSource).toContain('path={"/keyworker-app"}');
    expect(navigationSource).toContain('label: "Manager app"');
    expect(navigationSource).toContain('label: "Key Worker app"');
  });

  it("uses existing scoped platform contracts rather than an independent data store", () => {
    expect(managerSource).toContain("trpc.staffWorkspace.managerQueue.useQuery");
    expect(managerSource).toContain("Manager app restricted");
    expect(keyWorkerSource).toContain("trpc.keywork.context.useQuery");
    expect(keyWorkerSource).toContain("trpc.operations.clock.useMutation");
    expect(keyWorkerSource).toContain("Attendance exception");
    expect(keyWorkerSource).toContain("Key Worker app restricted");
    expect(keyworkRouterSource).toContain('listAccessiblePropertyIds(ctx.user.id, input.entityId, "young_person.read")');
    expect(keyworkRouterSource).toContain('assertPlacementCapability(ctx.user.id, input.placementId, "young_person.write")');
  });
});
