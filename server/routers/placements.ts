import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { carePlans, documentTemplates, localAuthorities, placements, properties, workerAssignments, youngPeople } from "../../drizzle/schema";
import { assertEntityCapability, assertPlacementCapability, getUserAccess, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { requireDb } from "./shared";
import {assertYoungPersonAge} from "../services/inputValidation";
import {encryptSensitive} from "../services/crypto";

export const placementsRouter = router({
  list: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "young_person.read");
    const { user, memberships } = await getUserAccess(ctx.user.id);
    const role = user.operationalRole === "owner" ? "owner" : memberships.find(item => item.entityId === input.entityId)?.operationalRole;
    const db = await requireDb();
    let permittedPlacementIds: number[] | undefined;
    if (role === "support_worker") {
      const assignments = await db.select({ id: workerAssignments.placementId }).from(workerAssignments).where(eq(workerAssignments.userId, ctx.user.id));
      permittedPlacementIds = assignments.map(item => item.id);
      if (!permittedPlacementIds.length) {
        await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "placement.list", resourceType: "placement", sensitivity: "safeguarding", result: "allowed", reasonCode: "assignment_filtered", metadata: { resultCount: 0 } });
        return [];
      }
    }
    const predicates = [eq(placements.entityId, input.entityId)];
    if (propertyIds.length) predicates.push(inArray(placements.propertyId, propertyIds));
    if (permittedPlacementIds) predicates.push(inArray(placements.id, permittedPlacementIds));
    const rows = await db.select({
      id: placements.id, entityId: placements.entityId, status: placements.status, propertyId: placements.propertyId,
      localAuthorityId: placements.localAuthorityId, startAt: placements.startAt, reviewDueAt: placements.reviewDueAt,
      purchaseOrderNumber: placements.purchaseOrderNumber, youngPersonId: youngPeople.id, reference: youngPeople.reference,
      preferredName: youngPeople.preferredName, propertyName: properties.name, authorityName: localAuthorities.name,
    }).from(placements)
      .innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId))
      .leftJoin(properties, eq(properties.id, placements.propertyId))
      .leftJoin(localAuthorities, eq(localAuthorities.id, placements.localAuthorityId))
      .where(and(...predicates));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "placement.list", resourceType: "placement", sensitivity: "safeguarding", result: "allowed", reasonCode: role === "support_worker" ? "assignment_filtered" : `role:${role}`, metadata: { resultCount: rows.length } });
    return rows;
  }),

  create: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), reference: z.string().min(3).max(64), preferredName: z.string().max(120).optional(),
    dateOfBirth: z.number().int().optional(), propertyId: z.number().int().positive().optional(), localAuthorityId: z.number().int().positive().optional(),
    placementBasis: z.enum(["section_22c_6_d", "section_23b_8_b", "other"]).optional(), referralReceivedAt: z.number().int().optional(),
    startAt: z.number().int().optional(), reviewDueAt: z.number().int().optional(), purchaseOrderNumber: z.string().max(100).optional(), hasEhcPlan: z.boolean().default(false),
    iroName: z.string().max(180).optional(), iroEmail: z.string().email().optional().or(z.literal("")), personalAdviserName: z.string().max(180).optional(), personalAdviserEmail: z.string().email().optional().or(z.literal("")), ageOverrideReason:z.string().max(4000).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "young_person.write");
    const access=await getUserAccess(ctx.user.id);const role=access.user.operationalRole==="owner"?"owner":access.memberships.find(item=>item.entityId===input.entityId)?.operationalRole;
    const ageDecision=assertYoungPersonAge({dateOfBirth:input.dateOfBirth,onDate:input.startAt??input.referralReceivedAt??Date.now(),overrideReason:input.ageOverrideReason,canOverride:role==="owner"||role==="registered_manager"});
    const db = await requireDb();
    const [duplicate] = await db.select({ id: youngPeople.id }).from(youngPeople).where(and(eq(youngPeople.entityId, input.entityId), eq(youngPeople.reference, input.reference))).limit(1);
    if (duplicate) throw new Error(`Young-person reference ${input.reference} already exists. Open the existing referral or placement rather than creating a duplicate.`);
    const result = await db.transaction(async tx => {
      const [youngPerson] = await tx.insert(youngPeople).values({
        entityId: input.entityId, reference: input.reference, preferredName: input.preferredName, dateOfBirth: input.dateOfBirth,
        status: input.startAt ? "placed" : "referral", createdBy: ctx.user.id,
      }).$returningId();
      const [placement] = await tx.insert(placements).values({
        entityId: input.entityId, youngPersonId: youngPerson.id, propertyId: input.propertyId, localAuthorityId: input.localAuthorityId,
        placementBasis: input.placementBasis, referralReceivedAt: input.referralReceivedAt ?? Date.now(), startAt: input.startAt,
        reviewDueAt: input.reviewDueAt, purchaseOrderNumber: input.purchaseOrderNumber, hasEhcPlan: input.hasEhcPlan ? 1 : 0,
        iroName: input.iroName, iroEmail: input.iroEmail || null, personalAdviserName: input.personalAdviserName,
        personalAdviserEmail: input.personalAdviserEmail || null, status: input.startAt ? "active" : "referred", createdBy: ctx.user.id,
      }).$returningId();
      return { youngPersonId: youngPerson.id, placementId: placement.id };
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "placement.create", resourceType: "placement", resourceId: result.placementId, sensitivity: "safeguarding", result: "success",metadata:{minimumAge:14,ageAtStart:ageDecision.age,agePolicyOverridden:ageDecision.overridden,overrideReasonCiphertext:ageDecision.overridden&&input.ageOverrideReason?encryptSensitive(input.ageOverrideReason):null} });
    return result;
  }),

  detail: protectedProcedure.input(z.object({ placementId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const { placement } = await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    const db = await requireDb();
    const [row] = await db.select({ placement: placements, youngPerson: youngPeople, property: properties, authority: localAuthorities }).from(placements)
      .innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId))
      .leftJoin(properties, eq(properties.id, placements.propertyId))
      .leftJoin(localAuthorities, eq(localAuthorities.id, placements.localAuthorityId))
      .where(eq(placements.id, input.placementId)).limit(1);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: placement.entityId, propertyId: placement.propertyId ?? undefined, action: "placement.read", resourceType: "placement", resourceId: placement.id, sensitivity: "safeguarding", result: "allowed" });
    return row;
  }),

  plans: protectedProcedure.input(z.object({ placementId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.read");
    const db = await requireDb();
    return db.select().from(carePlans).where(eq(carePlans.placementId, input.placementId));
  }),

  createPlan: protectedProcedure.input(z.object({
    placementId: z.number().int().positive(), planType: z.enum(["support", "pathway", "risk", "safety", "placement", "transition"]),
    summary: z.string().min(10).max(8000), reviewDueAt: z.number().int().optional(),
    content: z.record(z.string(), z.unknown()).optional(), templateId: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    const { placement } = await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.write");
    const db = await requireDb();
    const current = await db.select({ version: carePlans.version }).from(carePlans).where(and(eq(carePlans.placementId, input.placementId), eq(carePlans.planType, input.planType)));
    const version = Math.max(0, ...current.map(item => item.version)) + 1;
    const [template] = input.templateId ? await db.select().from(documentTemplates).where(and(eq(documentTemplates.id, input.templateId), eq(documentTemplates.entityId, placement.entityId), eq(documentTemplates.status, "active"))).limit(1) : [];
    const content = { ...(input.content ?? {}), template: template ? { id: template.id, title: template.title, category: template.category, version: template.version } : null };
    const [result] = await db.insert(carePlans).values({ entityId: placement.entityId, placementId: input.placementId, planType: input.planType, version, summary: input.summary, content, reviewDueAt: input.reviewDueAt, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: placement.entityId, propertyId: placement.propertyId ?? undefined, action: "care_plan.create", resourceType: "care_plan", resourceId: result.id, sensitivity: "safeguarding", result: "success", metadata: { planType: input.planType, version, templateId: template?.id ?? null, templateVersion: template?.version ?? null } });
    return { id: result.id, version };
  }),

  approvePlan: protectedProcedure.input(z.object({ placementId: z.number().int().positive(), planId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const { placement, access } = await assertPlacementCapability(ctx.user.id, input.placementId, "young_person.write");
    if (access.role === "support_worker" || access.role === "read_only") throw new Error("Manager approval is required");
    const db = await requireDb();
    const [plan] = await db.select().from(carePlans).where(and(eq(carePlans.id, input.planId), eq(carePlans.placementId, input.placementId))).limit(1);
    if (!plan) throw new Error("Plan not found");
    await db.transaction(async tx => {
      await tx.update(carePlans).set({ status: "superseded" }).where(and(eq(carePlans.placementId, input.placementId), eq(carePlans.planType, plan.planType), eq(carePlans.status, "approved")));
      await tx.update(carePlans).set({ status: "approved", approvedAt: Date.now(), approvedBy: ctx.user.id }).where(eq(carePlans.id, input.planId));
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: placement.entityId, propertyId: placement.propertyId ?? undefined, action: "care_plan.approve", resourceType: "care_plan", resourceId: input.planId, sensitivity: "safeguarding", result: "success" });
    return { success: true };
  }),

  assignWorker: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), placementId: z.number().int().positive(), userId: z.number().int().positive(), assignmentRole: z.enum(["key_worker", "co_worker", "manager", "oversight"]) })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "young_person.write");
    const db = await requireDb();
    await db.insert(workerAssignments).values({ ...input, startsAt: Date.now(), createdBy: ctx.user.id }).onDuplicateKeyUpdate({ set: { endsAt: null } });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "placement.assign_worker", resourceType: "placement", resourceId: input.placementId, sensitivity: "safeguarding", result: "success", metadata: { assignedUserId: input.userId, assignmentRole: input.assignmentRole } });
    return { success: true };
  }),
});
