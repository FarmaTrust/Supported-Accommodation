import { describe, expect, it } from "vitest";

function buildSupportMailto(code: string, page: string) { return `mailto:?subject=${encodeURIComponent("Supported Accommodation Hub sign-in support")}&body=${encodeURIComponent(`Developer code: ${code}\nPage: ${page}\nDo not include passwords, one-time codes or sensitive record details.`)}`; }
describe("support request email", () => it("includes a safe code and page but no credential prompt", () => { const link = decodeURIComponent(buildSupportMailto("AUTH_ACCESS_DENIED", "/finance")); expect(link).toContain("AUTH_ACCESS_DENIED"); expect(link).toContain("/finance"); expect(link).toContain("Do not include passwords"); }));
