import { beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME } from "../../shared/const";

const state = vi.hoisted(() => ({ tokenInput: null as any, cookieCall: null as any }));
vi.mock("../_core/sdk", () => ({ sdk: { createLocalSessionToken: vi.fn(async (input: any) => { state.tokenInput = input; return "signed-local-session"; }) } }));
vi.mock("../_core/cookies", () => ({ getSessionCookieOptions: vi.fn(() => ({ httpOnly: true, secure: true, sameSite: "none", path: "/" })) }));

import { issueLocalSession } from "./localSession";

describe("shared local-session issuance", () => {
  beforeEach(() => { state.tokenInput = null; state.cookieCall = null; });

  it("uses the normal version-bound local session and secure cookie policy", async () => {
    await issueLocalSession({ req: {}, res: { cookie: (...args: any[]) => { state.cookieCall = args; } } }, { id: 7, openId: "local-user", name: "Existing user", email: "user@example.test" } as any, 3);
    expect(state.tokenInput).toEqual({ openId: "local-user", name: "Existing user", passwordVersion: 3 });
    expect(state.cookieCall).toMatchObject([COOKIE_NAME, "signed-local-session", { httpOnly: true, secure: true, maxAge: 31_536_000_000 }]);
  });
});
