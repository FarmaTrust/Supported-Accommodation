import { describe, expect, it } from "vitest";
import { buildResetEmail, isPasswordResetEmailConfigured } from "./resetEmail";

describe("password-reset email configuration", () => {
  it("requires a provider key, verified sender and fixed HTTPS public URL", () => {
    expect(buildResetEmail({ email: "raja.sharif@farmatrust.com", token: "secret-token" }, { resendApiKey: "", resetEmailFrom: "raja.sharif@farmatrust.com", appPublicUrl: "https://hub.example" } as any)).toBeNull();
    expect(buildResetEmail({ email: "raja.sharif@farmatrust.com", token: "secret-token" }, { resendApiKey: "key", resetEmailFrom: "not-an-email", appPublicUrl: "https://hub.example" } as any)).toBeNull();
    expect(isPasswordResetEmailConfigured({ resendApiKey: "", resetEmailFrom: "raja.sharif@farmatrust.com", appPublicUrl: "https://hub.example" } as any)).toBe(false);
  });

  it("builds a one-hour reset delivery without putting the token in sender metadata", () => {
    const email = buildResetEmail({ email: "raja.sharif@farmatrust.com", token: "secret-token" }, { resendApiKey: "key", resetEmailFrom: "raja.sharif@farmatrust.com", appPublicUrl: "https://hub.example" } as any);
    expect(email?.body.to).toEqual(["raja.sharif@farmatrust.com"]);
    expect(email?.body.from).toBe("raja.sharif@farmatrust.com");
    expect(email?.body.text).toContain("https://hub.example/?resetToken=secret-token");
    expect(JSON.stringify({ url: email?.url, headers: email?.headers })).not.toContain("secret-token");
  });
});
