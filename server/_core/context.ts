import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { ResolvedUser } from "../services/roleResolution";
import { COOKIE_NAME } from "@shared/const";
import type { AuthFeedbackCode } from "@shared/authFeedback";
import { LegacySessionRetiredError, ProviderUnavailableError, sdk } from "./sdk";
import { getSessionCookieOptions } from "./cookies";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: ResolvedUser | null;
  authIssue?: AuthFeedbackCode;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: ResolvedUser | null = null;
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
    if (error instanceof LegacySessionRetiredError) {
      opts.res.clearCookie(COOKIE_NAME, getSessionCookieOptions(opts.req));
    } else if (hasSessionSignal) {
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
