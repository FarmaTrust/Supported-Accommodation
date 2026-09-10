import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(authIssue?: TrpcContext["authIssue"]): TrpcContext {
  return {
    user: null,
    authIssue,
    req: { headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("auth.status", () => {
  it("returns a safe session issue without session or provider detail", async () => {
    const result = await appRouter.createCaller(createContext("AUTH_SESSION_INVALID")).auth.status();
    expect(result).toEqual({ user: null, issue: "AUTH_SESSION_INVALID" });
  });

  it("does not present a normal signed-out state as a failure", async () => {
    const result = await appRouter.createCaller(createContext()).auth.status();
    expect(result).toEqual({ user: null, issue: null });
  });
});
