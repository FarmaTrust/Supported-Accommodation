import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { COOKIE_NAME } from "@shared/const";
import type { AuthFeedbackCode } from "@shared/authFeedback";
import { ProviderUnavailableError, sdk } from "./sdk";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  authIssue?: AuthFeedbackCode;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let authIssue: AuthFeedbackCode | undefined;
  const hasSessionSignal = Boolean(
    opts.req.headers.authorization?.startsWith("Bearer ") ||
    opts.req.headers.cookie?.includes(`${COOKIE_NAME}=`),
  );

  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    // Authentication is optional for public procedures.
    // Only surface a stable public code—never the session, provider or user detail.
    if (hasSessionSignal) {
      authIssue = error instanceof ProviderUnavailableError
        ? "AUTH_SERVICE_UNAVAILABLE"
        : "AUTH_SESSION_INVALID";
    }
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    authIssue,
  };
}
