import { COOKIE_NAME, ONE_YEAR_MS, OAUTH_STATE_COOKIE, decodeOAuthState } from "@shared/const";
import { parse as parseCookieHeader } from "cookie";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { isTemporaryProviderConnectivityError, sdk } from "./sdk";
import { writeAuditEvent } from "../services/audit";
import { acceptPendingColleagueInvitations } from "../services/colleagueProvisioning";
import type { AuthFeedbackCode } from "@shared/authFeedback";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

function redirectWithAuthFeedback(res: Response, code: AuthFeedbackCode) {
  res.redirect(302, `/?auth_error=${encodeURIComponent(code)}`);
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    const providerError = getQueryParam(req, "error");

    if (providerError) {
      redirectWithAuthFeedback(res, "AUTH_PROVIDER_REJECTED");
      return;
    }

    if (!code || !state) {
      redirectWithAuthFeedback(res, "AUTH_SIGN_IN_INCOMPLETE");
      return;
    }

    // CSRF guard: the nonce in `state` must match the one-time cookie that
    // startLogin set in the browser that began this login. An attacker can
    // forge `state`, but cannot plant this cookie in the victim's browser.
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      redirectWithAuthFeedback(res, "AUTH_SIGN_IN_EXPIRED");
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        redirectWithAuthFeedback(res, "AUTH_SIGN_IN_FAILED");
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });
      const signedInUser = await db.getUserByOpenId(userInfo.openId);
      if (signedInUser) await writeAuditEvent({ actorUserId: signedInUser.id, action: "auth.login", resourceType: "session", resourceId: userInfo.openId, result: "success", metadata: { loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null } });
      if (signedInUser) await acceptPendingColleagueInvitations({ userId: signedInUser.id, email: userInfo.email });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      redirectWithAuthFeedback(
        res,
        isTemporaryProviderConnectivityError(error)
          ? "AUTH_SERVICE_UNAVAILABLE"
          : "AUTH_SIGN_IN_FAILED",
      );
    }
  });
}
