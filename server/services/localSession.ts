import { type users } from "../../drizzle/schema";
import { COOKIE_NAME, ONE_YEAR_MS } from "../../shared/const";
import { getSessionCookieOptions } from "../_core/cookies";
import { sdk } from "../_core/sdk";

/**
 * Issues the standard version-bound local session used by both password and
 * administrator-approved temporary-link sign-in. This function never changes
 * credentials, account state, memberships or effective access scope.
 */
export async function issueLocalSession(
  ctx: { req: any; res: any },
  user: typeof users.$inferSelect,
  passwordVersion: number,
) {
  const sessionToken = await sdk.createLocalSessionToken({
    openId: user.openId,
    name: user.name || user.email || "Hub user",
    passwordVersion,
  });
  ctx.res.cookie(COOKIE_NAME, sessionToken, {
    ...getSessionCookieOptions(ctx.req),
    maxAge: ONE_YEAR_MS,
  });
}
