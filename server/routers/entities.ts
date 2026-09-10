import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { complianceObligations, documents, entities, entityMemberships, localAuthorities, occupancyEvents, properties, propertyEvidence, propertyUnits, users, workPlanActions } from "../../drizzle/schema";
import { assertEntityCapability, assertPropertyCapability, getUserAccess, listAccessiblePropertyIds } from "../authz";
import { protectedProcedure, router } from "../_core/trpc";
import { writeAuditEvent } from "../services/audit";
import { encryptSensitive } from "../services/crypto";
import { calculateRagStatus } from "../services/rules";
import { assertPropertyRecordDates, calculatePropertyRecordState, PROPERTY_COMPLIANCE_KINDS, PROPERTY_COMPLIANCE_LABELS, PROPERTY_COMPLIANCE_RECORD_TYPES } from "../services/propertyComplianceRules";
import { ensureOwner, requireDb } from "./shared";

export const entitiesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const db = await requireDb();
    const { user, memberships } = await getUserAccess(ctx.user.id);
    if (user.operationalRole === "owner") return db.select().from(entities);
    const ids = memberships.map(item => item.entityId);
    if (!ids.length) return [];
    return db.select().from(entities).where(inArray(entities.id, ids));
  }),

  create: protectedProcedure
    .input(z.object({
      name: z.string().min(2).max(160),
      legalName: z.string().min(2).max(220),
      companyNumber: z.string().max(32).optional(),
      ofstedUrn: z.string().max(64).optional(),
      email: z.string().email().optional().or(z.literal("")),
      invoicePrefix: z.string().min(2).max(12).regex(/^[A-Z0-9-]+$/),
      defaultVatRate: z.number().min(0).max(100).default(0),
    }))
    .mutation(async ({ ctx, input }) => {
      ensureOwner(ctx.user.operationalRole);
      const db = await requireDb();
      const existingEntities = await db.select({ id: entities.id, legalName: entities.legalName, companyNumber: entities.companyNumber }).from(entities);
      const duplicateEntity = existingEntities.find(item => item.legalName.trim().toLowerCase() === input.legalName.trim().toLowerCase() || (input.companyNumber && item.companyNumber?.replace(/\s+/g, "").toUpperCase() === input.companyNumber.replace(/\s+/g, "").toUpperCase()));
      if (duplicateEntity) throw new Error(`A legal entity with the same name or company number already exists (#${duplicateEntity.id}). Review it instead of creating a duplicate.`);
      const [result] = await db.insert(entities).values({
        ...input,
        email: input.email || null,
        defaultVatRate: input.defaultVatRate.toFixed(2),
        createdBy: ctx.user.id,
        status: "active",
      }).$returningId();
      await db.insert(entityMemberships).values({
        entityId: result.id,
        userId: ctx.user.id,
        operationalRole: "owner",
        allProperties: 1,
        createdBy: ctx.user.id,
      }).onDuplicateKeyUpdate({ set: { status: "active", operationalRole: "owner", allProperties: 1 } });
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: result.id, action: "entity.create", resourceType: "entity", resourceId: result.id, result: "success" });
      return { id: result.id };
    }),

  updateBankDetails: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(),
    accountName: z.string().min(2).max(180),
    sortCode: z.string().regex(/^\d{2}-?\d{2}-?\d{2}$/),
    accountNumber: z.string().regex(/^\d{8}$/),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.write");
    const db = await requireDb();
    await db.update(entities).set({
      bankAccountName: input.accountName,
      bankSortCodeCiphertext: encryptSensitive(input.sortCode.replaceAll("-", "")),
      bankAccountNumberCiphertext: encryptSensitive(input.accountNumber),
      bankDetailsUpdatedAt: Date.now(),
      bankDetailsUpdatedBy: ctx.user.id,
    }).where(eq(entities.id, input.entityId));
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "entity.bank_details.update", resourceType: "entity", resourceId: input.entityId, sensitivity: "bank", result: "success" });
    return { success: true };
  }),

  members: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "compliance.write");
    const db = await requireDb();
    return db.select({ userId: users.id, name: users.name, email: users.email, role: entityMemberships.operationalRole })
      .from(entityMemberships).innerJoin(users, eq(users.id, entityMemberships.userId))
      .where(and(eq(entityMemberships.entityId, input.entityId), eq(entityMemberships.status, "active")));
  }),

  properties: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "property.read");
    const db = await requireDb();
    return db.select().from(properties).where(eq(properties.entityId, input.entityId));
  }),

  createProperty: protectedProcedure
    .input(z.object({
      entityId: z.number().int().positive(),
      name: z.string().min(2).max(160),
      addressLine1: z.string().min(3).max(180),
      city: z.string().min(2).max(120),
      postcode: z.string().min(5).max(16),
      accommodationType: z.enum(["single_occupancy", "ring_fenced_shared", "non_ring_fenced_shared", "supported_lodgings", "other"]),
      capacity: z.number().int().min(1).max(100),
      minimumStaffing: z.number().int().min(1).max(20).default(1),
      ofstedSettingReference: z.string().max(80).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertEntityCapability(ctx.user.id, input.entityId, "property.write");
      const db = await requireDb();
      const currentProperties = await db.select({ id: properties.id, addressLine1: properties.addressLine1, postcode: properties.postcode }).from(properties).where(eq(properties.entityId, input.entityId));
      const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, ""); const duplicate = currentProperties.find(item => normalise(item.addressLine1) === normalise(input.addressLine1) && normalise(item.postcode) === normalise(input.postcode));
      if (duplicate) throw new Error(`This address already exists as property #${duplicate.id}. Open that record rather than creating another.`);
      const [result] = await db.insert(properties).values({ ...input, createdBy: ctx.user.id, status: "onboarding" }).$returningId();
      await db.insert(workPlanActions).values({
        entityId: input.entityId,
        propertyId: result.id,
        title: "Complete property onboarding evidence",
        description: "Add location assessment, statutory safety evidence, insurance and responsible-person details before marking the property active.",
        sourceType: "property_onboarding",
        sourceId: result.id,
        priority: "high",
        dueAt: Date.now() + 14 * 86_400_000,
        createdBy: ctx.user.id,
      });
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: result.id, action: "property.create", resourceType: "property", resourceId: result.id, result: "success" });
      return { id: result.id };
    }),

  propertyDetail: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), propertyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "property.read");
    const db = await requireDb();
    const [[property], units, history] = await Promise.all([
      db.select().from(properties).where(and(eq(properties.id, input.propertyId), eq(properties.entityId, input.entityId))).limit(1),
      db.select().from(propertyUnits).where(eq(propertyUnits.propertyId, input.propertyId)),
      db.select().from(occupancyEvents).where(eq(occupancyEvents.propertyId, input.propertyId)).orderBy(desc(occupancyEvents.effectiveAt)).limit(50),
    ]);
    return { property, units, history };
  }),

  propertyEvidence: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), propertyId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "compliance.read");
    const db = await requireDb();
    const rows = await db.select().from(propertyEvidence).where(and(eq(propertyEvidence.entityId, input.entityId), eq(propertyEvidence.propertyId, input.propertyId))).orderBy(desc(propertyEvidence.dueAt));
    return rows.map(item => ({ ...item, ragStatus: item.dueAt ? calculateRagStatus(item.dueAt, item.status === "closed" ? item.updatedAt.getTime() : null, 30) : "grey" as const }));
  }),

  createPropertyEvidence: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(),
    recordType: z.enum(["certificate", "insurance", "lease", "licence", "contractor", "maintenance", "inventory", "location_assessment", "fire_risk", "gas_safety", "electrical_safety", "water_safety", "other"]),
    title: z.string().min(3).max(240), providerName: z.string().max(180).optional(), reference: z.string().max(160).optional(),
    issuedAt: z.number().int().optional(), dueAt: z.number().int().optional(), documentId: z.number().int().positive().optional(), details: z.record(z.string(), z.unknown()).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "compliance.write");
    const db = await requireDb();
    const status = input.dueAt ? (calculateRagStatus(input.dueAt, null, 30) === "red" ? "expired" : calculateRagStatus(input.dueAt, null, 30) === "amber" ? "due_soon" : "valid") : "draft";
    const result = await db.transaction(async tx => {
      const [record] = await tx.insert(propertyEvidence).values({ ...input, status, createdBy: ctx.user.id }).$returningId();
      if (input.dueAt) await tx.insert(complianceObligations).values({ entityId: input.entityId, propertyId: input.propertyId, category: "property", requirementKey: `property-evidence:${record.id}`, title: input.title, basis: input.recordType.replaceAll("_", " "), dueAt: input.dueAt, leadDays: 30, evidenceDocumentId: input.documentId, sourceType: "property_evidence", sourceId: record.id, status: status === "expired" ? "overdue" : status === "due_soon" ? "due_soon" : "not_due", ragStatus: status === "expired" ? "red" : status === "due_soon" ? "amber" : "green", createdBy: ctx.user.id });
      return record.id;
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "property_evidence.create", resourceType: "property_evidence", resourceId: result, result: "success", metadata: { recordType: input.recordType, dueAt: input.dueAt } });
    return { id: result };
  }),

  propertyComplianceWorkspace: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const propertyIds = await listAccessiblePropertyIds(ctx.user.id, input.entityId, "compliance.read"); const db = await requireDb(); if (!propertyIds.length) return { properties: [], documents: [], records: [] };
    const [propertyRows, documentRows, evidenceRows] = await Promise.all([
      db.select({ id: properties.id, name: properties.name, addressLine1: properties.addressLine1, postcode: properties.postcode }).from(properties).where(and(eq(properties.entityId, input.entityId), inArray(properties.id, propertyIds))),
      db.select({ id: documents.id, propertyId: documents.propertyId, title: documents.title, status: documents.status, documentType: documents.documentType }).from(documents).where(and(eq(documents.entityId, input.entityId), inArray(documents.propertyId, propertyIds), eq(documents.status, "approved"))),
      db.select().from(propertyEvidence).where(and(eq(propertyEvidence.entityId, input.entityId), inArray(propertyEvidence.propertyId, propertyIds), inArray(propertyEvidence.recordType, ["licence", "gas_safety", "electrical_safety", "fire_risk"]))),
    ]);
    const propertyNames=new Map(propertyRows.map(item=>[item.id,item.name]));const documentMap=new Map(documentRows.map(item=>[item.id,item]));
    const records=evidenceRows.filter(item=>PROPERTY_COMPLIANCE_KINDS.includes((item.details as any)?.propertyComplianceKind)).map(item=>{const document=item.documentId?documentMap.get(item.documentId):undefined;const state=calculatePropertyRecordState({dueAt:item.dueAt??0,evidenceApproved:document?.status==="approved"});return{...item,kind:(item.details as any).propertyComplianceKind,notes:typeof(item.details)==="object"&&item.details?String((item.details as any).notes??""):"",propertyName:propertyNames.get(item.propertyId)??"Property",evidenceTitle:document?.title??null,status:state.status,ragStatus:state.ragStatus};});
    return{properties:propertyRows,documents:documentRows.filter(item=>["certificate","evidence"].includes(item.documentType)),records:records.sort((a,b)=>(a.dueAt??0)-(b.dueAt??0))};
  }),

  createPropertyComplianceRecord: protectedProcedure.input(z.object({entityId:z.number().int().positive(),propertyId:z.number().int().positive(),kind:z.enum(PROPERTY_COMPLIANCE_KINDS),reference:z.string().trim().min(2,"Enter the certificate or registration reference").max(160),issuedAt:z.number().int(),dueAt:z.number().int(),providerName:z.string().trim().min(2,"Enter the provider, inspector or registration body").max(180),documentId:z.number().int().positive().optional(),notes:z.string().trim().max(2000).optional()})).mutation(async({ctx,input})=>{
    await assertPropertyCapability(ctx.user.id,input.entityId,input.propertyId,"compliance.write");assertPropertyRecordDates(input.issuedAt,input.dueAt);const db=await requireDb();const[property]=await db.select({id:properties.id,name:properties.name}).from(properties).where(and(eq(properties.id,input.propertyId),eq(properties.entityId,input.entityId))).limit(1);if(!property)throw new Error("Property is not available in this entity");
    const[evidenceDocument]=input.documentId?await db.select({id:documents.id,status:documents.status,propertyId:documents.propertyId}).from(documents).where(and(eq(documents.id,input.documentId),eq(documents.entityId,input.entityId),eq(documents.propertyId,input.propertyId))).limit(1):[];if(input.documentId&&!evidenceDocument)throw new Error("Select an evidence document attached to this property");if(evidenceDocument&&evidenceDocument.status!=="approved")throw new Error("Evidence must be approved in Documents before it can validate this record");
    const state=calculatePropertyRecordState({dueAt:input.dueAt,evidenceApproved:Boolean(evidenceDocument)});const title=`${PROPERTY_COMPLIANCE_LABELS[input.kind]} — ${property.name}`;const id=await db.transaction(async tx=>{const[record]=await tx.insert(propertyEvidence).values({entityId:input.entityId,propertyId:input.propertyId,recordType:PROPERTY_COMPLIANCE_RECORD_TYPES[input.kind],title,providerName:input.providerName,reference:input.reference,issuedAt:input.issuedAt,dueAt:input.dueAt,status:state.status,documentId:input.documentId,details:{propertyComplianceKind:input.kind,notes:input.notes??""},createdBy:ctx.user.id}).$returningId();await tx.insert(complianceObligations).values({entityId:input.entityId,propertyId:input.propertyId,category:"property",requirementKey:`property-evidence:${record.id}`,title,basis:PROPERTY_COMPLIANCE_LABELS[input.kind],dueAt:input.dueAt,leadDays:30,evidenceDocumentId:input.documentId,sourceType:"property_evidence",sourceId:record.id,status:state.ragStatus==="red"?"overdue":state.ragStatus==="amber"?"due_soon":"not_due",ragStatus:state.ragStatus,createdBy:ctx.user.id});return record.id;});await writeAuditEvent({actorUserId:ctx.user.id,entityId:input.entityId,propertyId:input.propertyId,action:"property_compliance.create",resourceType:"property_evidence",resourceId:id,result:"success",metadata:{kind:input.kind,dueAt:input.dueAt,evidenceDocumentId:input.documentId??null,status:state.status}});return{id,status:state.status};
  }),

  linkPropertyComplianceEvidence: protectedProcedure.input(z.object({entityId:z.number().int().positive(),recordId:z.number().int().positive(),documentId:z.number().int().positive()})).mutation(async({ctx,input})=>{const db=await requireDb();const[record]=await db.select().from(propertyEvidence).where(and(eq(propertyEvidence.id,input.recordId),eq(propertyEvidence.entityId,input.entityId))).limit(1);if(!record)throw new Error("Property compliance record was not found");await assertPropertyCapability(ctx.user.id,input.entityId,record.propertyId,"compliance.write");const[document]=await db.select({id:documents.id,status:documents.status}).from(documents).where(and(eq(documents.id,input.documentId),eq(documents.entityId,input.entityId),eq(documents.propertyId,record.propertyId))).limit(1);if(!document)throw new Error("Select an evidence document attached to the same property");if(document.status!=="approved")throw new Error("Evidence must be approved in Documents before it can validate this record");const state=calculatePropertyRecordState({dueAt:record.dueAt??0,evidenceApproved:true});await db.transaction(async tx=>{await tx.update(propertyEvidence).set({documentId:document.id,status:state.status}).where(eq(propertyEvidence.id,record.id));await tx.update(complianceObligations).set({evidenceDocumentId:document.id,status:state.ragStatus==="red"?"overdue":state.ragStatus==="amber"?"due_soon":"not_due",ragStatus:state.ragStatus}).where(and(eq(complianceObligations.sourceType,"property_evidence"),eq(complianceObligations.sourceId,record.id),eq(complianceObligations.entityId,input.entityId)));});await writeAuditEvent({actorUserId:ctx.user.id,entityId:input.entityId,propertyId:record.propertyId,action:"property_compliance.evidence_link",resourceType:"property_evidence",resourceId:record.id,result:"success",metadata:{documentId:document.id,status:state.status}});return{success:true,status:state.status};}),

  createUnit: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(), label: z.string().min(1).max(100),
    unitType: z.enum(["bedroom", "self_contained", "lodgings_room", "other"]), capacity: z.number().int().min(1).max(10).default(1),
  })).mutation(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "property.write");
    const db = await requireDb();
    const [result] = await db.insert(propertyUnits).values({ ...input, createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: "property_unit.create", resourceType: "property_unit", resourceId: result.id, result: "success" });
    return { id: result.id };
  }),

  recordOccupancy: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), propertyId: z.number().int().positive(), unitId: z.number().int().positive(),
    placementId: z.number().int().positive().optional(), eventType: z.enum(["reserved", "move_in", "move_out", "made_available", "maintenance_start", "maintenance_end"]),
    effectiveAt: z.number().int(), reason: z.string().max(2000).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertPropertyCapability(ctx.user.id, input.entityId, input.propertyId, "property.write");
    const db = await requireDb();
    const statusMap = { reserved: "reserved", move_in: "occupied", move_out: "available", made_available: "available", maintenance_start: "maintenance", maintenance_end: "available" } as const;
    const id = await db.transaction(async tx => {
      const [event] = await tx.insert(occupancyEvents).values({ ...input, createdBy: ctx.user.id }).$returningId();
      await tx.update(propertyUnits).set({ status: statusMap[input.eventType] }).where(and(eq(propertyUnits.id, input.unitId), eq(propertyUnits.propertyId, input.propertyId)));
      const units = await tx.select({ status: propertyUnits.status, capacity: propertyUnits.capacity }).from(propertyUnits).where(eq(propertyUnits.propertyId, input.propertyId));
      const occupied = units.filter(unit => unit.status === "occupied").reduce((sum, unit) => sum + unit.capacity, 0);
      await tx.update(properties).set({ occupiedBeds: occupied }).where(eq(properties.id, input.propertyId));
      return event.id;
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, propertyId: input.propertyId, action: `occupancy.${input.eventType}`, resourceType: "occupancy_event", resourceId: id, result: "success", metadata: { unitId: input.unitId, placementId: input.placementId } });
    return { id };
  }),

  authorities: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read");
    const db = await requireDb();
    return db.select().from(localAuthorities).where(eq(localAuthorities.entityId, input.entityId));
  }),

  createAuthority: protectedProcedure
    .input(z.object({
      entityId: z.number().int().positive(), name: z.string().min(2).max(220),
      addressLine1: z.string().max(180).optional(), city: z.string().max(120).optional(), postcode: z.string().max(16).optional(),
      financeEmail: z.string().email().optional().or(z.literal("")), placementEmail: z.string().email().optional().or(z.literal("")),
      paymentTermsDays: z.number().int().min(0).max(365).default(30), defaultPurchaseOrderRequired: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertEntityCapability(ctx.user.id, input.entityId, "finance.write");
      const db = await requireDb();
      const [result] = await db.insert(localAuthorities).values({
        ...input,
        financeEmail: input.financeEmail || null,
        placementEmail: input.placementEmail || null,
        defaultPurchaseOrderRequired: input.defaultPurchaseOrderRequired ? 1 : 0,
        createdBy: ctx.user.id,
      }).$returningId();
      await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "authority.create", resourceType: "local_authority", resourceId: result.id, result: "success" });
      return { id: result.id };
    }),
});
