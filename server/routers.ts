import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { dashboardRouter } from "./routers/dashboard";
import { entitiesRouter } from "./routers/entities";
import { workforceRouter } from "./routers/workforce";
import { complianceRouter } from "./routers/compliance";
import { operationsRouter } from "./routers/operations";
import { placementsRouter } from "./routers/placements";
import { keyworkRouter } from "./routers/keywork";
import { financeRouter } from "./routers/finance";
import { documentsRouter } from "./routers/documents";
import { workspaceRouter } from "./routers/workspace";
import { offlineSyncRouter } from "./routers/offlineSync";
import { assuranceRouter } from "./routers/assurance";
import { qualityRouter } from "./routers/quality";
import { regulation28Router } from "./routers/regulation28";
import { careRouter } from "./routers/care";
import { safeguardingRouter } from "./routers/safeguarding";
import { rotaControlsRouter } from "./routers/rotaControls";
import { governanceRouter } from "./routers/governance";
import { complianceHubRouter } from "./routers/complianceHub";
import { staffWorkspaceRouter } from "./routers/staffWorkspace";
import { governanceHubRouter } from "./routers/governanceHub";
import { accessControlRouter } from "./routers/accessControl";
import { guestInvitationsRouter } from "./routers/guestInvitations";
import { colleagueInvitationsRouter } from "./routers/colleagueInvitations";
import { localAuthRouter } from "./routers/localAuth";
import { superadminRouter } from "./routers/superadmin";
import { temporaryLoginLinksRouter } from "./routers/temporaryLoginLinks";
import { requiresLocalPasswordChange } from "./services/localAuth";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    status: publicProcedure.query(async opts => ({
      user: opts.ctx.user,
      issue: opts.ctx.user ? null : (opts.ctx.authIssue ?? null),
      passwordChangeRequired: opts.ctx.user ? await requiresLocalPasswordChange(opts.ctx.user.id) : false,
    })),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, cookieOptions);
      return {
        success: true,
      } as const;
    }),
  }),
  dashboard: dashboardRouter,
  entities: entitiesRouter,
  workforce: workforceRouter,
  compliance: complianceRouter,
  operations: operationsRouter,
  placements: placementsRouter,
  keywork: keyworkRouter,
  finance: financeRouter,
  documents: documentsRouter,
  workspace: workspaceRouter,
  offlineSync: offlineSyncRouter,
  assurance: assuranceRouter,
  quality: qualityRouter,
  regulation28: regulation28Router,
  care: careRouter,
  safeguarding: safeguardingRouter,
  rotaControls: rotaControlsRouter,
  governance: governanceRouter,
  complianceHub: complianceHubRouter,
  staffWorkspace: staffWorkspaceRouter,
  governanceHub: governanceHubRouter,
  accessControl: accessControlRouter,
  guestInvitations: guestInvitationsRouter,
  colleagueInvitations: colleagueInvitationsRouter,
  localAuth: localAuthRouter,
  temporaryLoginLinks: temporaryLoginLinksRouter,
  superadmin: superadminRouter,

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
