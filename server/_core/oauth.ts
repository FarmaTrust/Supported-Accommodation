import type { Express, Request, Response } from "express";
import type { AuthFeedbackCode } from "@shared/authFeedback";

function redirectWithAuthFeedback(res: Response, code: AuthFeedbackCode) {
  res.redirect(302, `/?auth_error=${encodeURIComponent(code)}`);
}

/**
 * Retained only to give legacy bookmarks and in-flight provider callbacks a
 * safe local redirect. Identity verification and sessions are now handled by
 * MySQL-backed email/password authentication routes.
 */
export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", (_req: Request, res: Response) => {
    redirectWithAuthFeedback(res, "AUTH_LOCAL_SIGN_IN_REQUIRED");
  });
}
