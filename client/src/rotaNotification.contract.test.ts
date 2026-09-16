import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("compact rota and notification interactions", () => {
  it("renders Rota Controls as compact horizontal actions with a relevant queue destination", () => {
    const source = read("client/src/pages/RotaControls.tsx");
    expect(source).toContain("operational-row operational-row-action");
    expect(source).toContain("openQueue(metric.target)");
    expect(source).toContain("shift-change-alerts");
    expect(source).toContain("Payroll-ready summaries");
  });

  it("keeps rota and notification list rows compact while retaining operational actions", () => {
    const rotaSource = read("client/src/pages/Rota.tsx");
    const searchSource = read("client/src/pages/Search.tsx");
    expect(rotaSource).toContain('className="operational-row"');
    expect(rotaSource).toContain("Clock in");
    expect(searchSource).toContain("operational-row flex-wrap");
    expect(searchSource).toContain('type === "handover_acknowledgement" ? "/keyworker-app"');
  });

  it("provides an opt-in sound control and pings only newly received unread alerts", () => {
    const layoutSource = read("client/src/components/DashboardLayout.tsx");
    const hookSource = read("client/src/hooks/useNotificationSound.tsx");
    expect(layoutSource).toContain("NotificationSoundControl");
    expect(layoutSource).toContain("refetchInterval: 30_000");
    expect(hookSource).toContain("newUnreadNotificationIds");
    expect(hookSource).toContain('window.localStorage.setItem(STORAGE_KEY, next ? "enabled" : "disabled")');
  });
});
