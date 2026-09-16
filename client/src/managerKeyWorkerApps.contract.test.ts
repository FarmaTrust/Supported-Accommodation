import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const appSource = readFileSync(new URL("client/src/App.tsx", root), "utf8");
const navigationSource = readFileSync(new URL("client/src/components/DashboardLayout.tsx", root), "utf8");
const managerSource = readFileSync(new URL("client/src/pages/ManagerApp.tsx", root), "utf8");
const keyWorkerSource = readFileSync(new URL("client/src/pages/KeyWorkerApp.tsx", root), "utf8");
const reportSource = readFileSync(new URL("client/src/pages/KeyWorker.tsx", root), "utf8");
const dictationSource = readFileSync(new URL("client/src/components/DictationFields.tsx", root), "utf8");
const dictationHelperSource = readFileSync(new URL("client/src/lib/dictation.ts", root), "utf8");
const visitorSource = readFileSync(new URL("client/src/components/VisitorLogDialog.tsx", root), "utf8");
const keyworkRouterSource = readFileSync(new URL("server/routers/keywork.ts", root), "utf8");

describe("Manager and Key Worker mobile app entry points", () => {
  it("registers dedicated app routes and visible navigation entries", () => {
    expect(appSource).toContain('path={"/manager-app"}');
    expect(appSource).toContain('path={"/keyworker-app"}');
    expect(appSource).toContain('path={"/key-worker"} component={KeyWorkerPage}');
    expect(navigationSource).toContain('label: "Manager app"');
    expect(navigationSource).toContain('label: "Keyworker App"');
    expect(navigationSource).not.toContain('label: "Key Worker app"');
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

  it("places attendance, incoming handovers and required reports before secondary Keyworker actions", () => {
    expect(keyWorkerSource.indexOf("1 · Attendance")).toBeLessThan(keyWorkerSource.indexOf("2 · Incoming shift"));
    expect(keyWorkerSource.indexOf("2 · Incoming shift")).toBeLessThan(keyWorkerSource.indexOf("3 · Required records"));
    expect(keyWorkerSource).toContain("trpc.operations.acknowledgeHandover.useMutation");
    expect(keyWorkerSource).toContain("I have read this");
  });

  it("uses established scoped visitor and report workflows rather than dead links", () => {
    expect(keyWorkerSource).toContain("VisitorLogDialog");
    expect(managerSource).toContain("VisitorLogDialog");
    expect(visitorSource).toContain("trpc.staffWorkspace.arriveVisitor.useMutation");
    expect(visitorSource).toContain("trpc.staffWorkspace.departVisitor.useMutation");
    expect(reportSource).toContain("Dictation and review");
    expect(reportSource).toContain("DictationInput label={label}");
    expect(dictationSource).toContain("browserSpeechRecognition(window)");
    expect(dictationHelperSource).toContain("webkitSpeechRecognition");
    expect(reportSource).toContain("context.data && placementId");
    expect(keyworkRouterSource).toContain("learning: z.string().max(8000).optional()");
    expect(keyworkRouterSource).toContain("enthusiasm: z.string().max(120).optional()");
  });
});
