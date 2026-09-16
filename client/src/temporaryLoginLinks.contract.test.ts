import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const appSource = readFileSync(new URL("client/src/App.tsx", root), "utf8");
const panelSource = readFileSync(new URL("client/src/components/TemporaryLoginLinksPanel.tsx", root), "utf8");
const redeemSource = readFileSync(new URL("client/src/pages/TemporaryLoginLink.tsx", root), "utf8");

describe("temporary login-link client flow", () => {
  it("registers the public redemption route outside the authenticated dashboard shell", () => {
    const route = 'path={"/access/temporary/:token"} component={TemporaryLoginLinkPage}';
    expect(appSource).toContain(route);
    expect(appSource.indexOf(route)).toBeLessThan(appSource.indexOf("<DashboardLayout>"));
  });

  it("provides administrator issue/list/revoke controls for credential-ready active accounts", () => {
    expect(panelSource).toContain("trpc.temporaryLoginLinks.issue.useMutation");
    expect(panelSource).toContain("trpc.temporaryLoginLinks.list.useQuery");
    expect(panelSource).toContain("trpc.temporaryLoginLinks.revoke.useMutation");
    expect(panelSource).toContain("member.hasLocalCredential === true");
    expect(panelSource).toContain("30 days (maximum)");
    expect(panelSource).toContain("will not be shown again");
  });

  it("uses the public redemption procedure and a generic unavailable state", () => {
    expect(redeemSource).toContain("trpc.temporaryLoginLinks.redeem.useMutation");
    expect(redeemSource).toContain("Temporary sign-in link unavailable");
    expect(redeemSource).toContain("expired, been revoked, already been used");
  });
});
