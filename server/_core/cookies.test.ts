import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./cookies";

describe("session cookie policy", () => {
  it("uses secure cross-site cookies for HTTPS deployment requests", () => {
    expect(getSessionCookieOptions({ protocol: "https", headers: {} } as any)).toMatchObject({ secure: true, sameSite: "none", httpOnly: true, path: "/" });
  });

  it("uses an HTTP-compatible same-site policy for localhost development", () => {
    expect(getSessionCookieOptions({ protocol: "http", headers: {}, hostname: "localhost" } as any)).toMatchObject({ secure: false, sameSite: "lax", httpOnly: true, path: "/" });
  });
});
