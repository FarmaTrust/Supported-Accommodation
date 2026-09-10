import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createHash, randomBytes } from "node:crypto";
import { creditNotes, documentVersions, documents, entities, feeSchedules, invoiceEvents, invoiceLines, invoices, localAuthorities, payments, placements, properties, secureLinks, statementArchives, youngPeople } from "../../drizzle/schema";
import { assertEntityCapability } from "../authz";
import { protectedProcedure, publicProcedure, router } from "../_core/trpc";
import { storagePut } from "../storage";
import { writeAuditEvent } from "../services/audit";
import { decryptSensitive, encryptSensitive } from "../services/crypto";
import { renderInvoicePdf } from "../services/invoicePdf";
import { calculateInvoiceLine, formatInvoiceNumber } from "../services/rules";
import { hashSecureToken, isSecureLinkUsable } from "../services/security";
import { requireDb } from "./shared";
import { assertStatementRange } from "../services/statementRules";
import { calculateStatement } from "../services/statementArchive";
import { renderStatementPdf } from "../services/statementPdf";

const periodQuantity = (unit: "daily" | "weekly" | "four_week" | "monthly" | "fixed") =>
  unit === "daily" ? 28 : unit === "weekly" ? 4 : 1;

export const financeRouter = router({
  feeSchedules: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read");
    const db = await requireDb();
    return db.select().from(feeSchedules).where(eq(feeSchedules.entityId, input.entityId));
  }),

  createFeeSchedule: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), localAuthorityId: z.number().int().positive().optional(), propertyId: z.number().int().positive().optional(),
    placementType: z.string().max(120).optional(), contractReference: z.string().max(160).optional(),
    name: z.string().min(3).max(180), billingUnit: z.enum(["daily", "weekly", "four_week", "monthly", "fixed"]),
    rate: z.number().min(0).max(1_000_000), vatRate: z.number().min(0).max(100).default(0),
    vatTreatment: z.enum(["standard", "reduced", "zero", "exempt", "outside_scope"]), effectiveFrom: z.number().int(), effectiveTo: z.number().int().optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.write");
    const db = await requireDb();
    const [result] = await db.insert(feeSchedules).values({ ...input, rate: input.rate.toFixed(2), vatRate: input.vatRate.toFixed(2), status: "active", createdBy: ctx.user.id }).$returningId();
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "fee_schedule.create", resourceType: "fee_schedule", resourceId: result.id, sensitivity: "finance", result: "success" });
    return { id: result.id };
  }),

  invoices: protectedProcedure.input(z.object({ entityId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read");
    const db = await requireDb();
    await db.update(invoices).set({ status: "overdue" }).where(and(eq(invoices.entityId, input.entityId), inArray(invoices.status, ["issued", "sent", "part_paid"]), lt(invoices.dueAt, Date.now())));
    return db.select().from(invoices).where(eq(invoices.entityId, input.entityId)).orderBy(asc(invoices.invoiceDate));
  }),

  invoiceDetail: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read");
    const db = await requireDb();
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1);
    if (!invoice) throw new Error("Invoice not found");
    const [lines, allocated] = await Promise.all([
      db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, input.invoiceId)),
      db.select().from(payments).where(eq(payments.invoiceId, input.invoiceId)),
    ]);
    const [credits, events] = await Promise.all([db.select().from(creditNotes).where(eq(creditNotes.invoiceId, input.invoiceId)), db.select().from(invoiceEvents).where(eq(invoiceEvents.invoiceId, input.invoiceId)).orderBy(asc(invoiceEvents.occurredAt))]);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.read", resourceType: "invoice", resourceId: input.invoiceId, sensitivity: "finance", result: "allowed" });
    return { invoice, lines, payments: allocated, credits, events };
  }),

  suggestInvoice: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), placementId: z.number().int().positive(), periodStart: z.number().int() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.write");
    const db = await requireDb();
    const [context] = await db.select({
      placement: placements, reference: youngPeople.reference, authority: localAuthorities, property: properties,
    }).from(placements).innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId))
      .leftJoin(localAuthorities, eq(localAuthorities.id, placements.localAuthorityId))
      .leftJoin(properties, eq(properties.id, placements.propertyId))
      .where(and(eq(placements.id, input.placementId), eq(placements.entityId, input.entityId))).limit(1);
    if (!context) throw new Error("Placement not found");
    const candidateFees = await db.select().from(feeSchedules).where(and(
      eq(feeSchedules.entityId, input.entityId), eq(feeSchedules.status, "active"), lte(feeSchedules.effectiveFrom, input.periodStart),
      or(isNull(feeSchedules.effectiveTo), gte(feeSchedules.effectiveTo, input.periodStart)),
    ));
    const fee = candidateFees
      .filter(item => (!item.localAuthorityId || item.localAuthorityId === context.placement.localAuthorityId)
        && (!item.propertyId || item.propertyId === context.placement.propertyId)
        && (!item.placementType || item.placementType === context.placement.placementBasis))
      .sort((a, b) => Number(Boolean(b.localAuthorityId)) + Number(Boolean(b.propertyId)) + Number(Boolean(b.placementType)) - Number(Boolean(a.localAuthorityId)) - Number(Boolean(a.propertyId)) - Number(Boolean(a.placementType)))[0];
    const periodEnd = input.periodStart + 28 * 86_400_000 - 1;
    if (!fee) return { context, periodEnd, fee: null, line: null };
    const quantity = periodQuantity(fee.billingUnit);
    return { context, periodEnd, fee, line: { quantity, ...calculateInvoiceLine(quantity, Number(fee.rate), Number(fee.vatRate)) } };
  }),

  createDraft: protectedProcedure.input(z.object({
    entityId: z.number().int().positive(), localAuthorityId: z.number().int().positive(), placementId: z.number().int().positive(),
    feeScheduleId: z.number().int().positive(), invoiceDate: z.number().int(), periodStart: z.number().int(), periodEnd: z.number().int(),
    purchaseOrderNumber: z.string().max(100).optional(), quantity: z.number().positive(), unitPrice: z.number().min(0), vatRate: z.number().min(0).max(100),
    description: z.string().min(3).max(300), notes: z.string().max(4000).optional(),
  })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.write");
    const db = await requireDb();
    const [duplicate] = await db.select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status }).from(invoices).where(and(eq(invoices.entityId, input.entityId), eq(invoices.placementId, input.placementId), eq(invoices.periodStart, input.periodStart), eq(invoices.periodEnd, input.periodEnd))).limit(1);
    if (duplicate && duplicate.status !== "void") throw new Error(`This placement and fee period already has ${duplicate.invoiceNumber ?? `draft #${duplicate.id}`}. Open it to correct, credit or reissue rather than creating a duplicate.`);
    const [context] = await db.select({ entity: entities, authority: localAuthorities, reference: youngPeople.reference })
      .from(placements).innerJoin(youngPeople, eq(youngPeople.id, placements.youngPersonId))
      .innerJoin(localAuthorities, eq(localAuthorities.id, input.localAuthorityId))
      .innerJoin(entities, eq(entities.id, input.entityId))
      .where(and(eq(placements.id, input.placementId), eq(placements.entityId, input.entityId))).limit(1);
    if (!context) throw new Error("Invoice context not found");
    const totals = calculateInvoiceLine(input.quantity, input.unitPrice, input.vatRate);
    const result = await db.transaction(async tx => {
      const [invoice] = await tx.insert(invoices).values({
        entityId: input.entityId, localAuthorityId: input.localAuthorityId, placementId: input.placementId,
        invoiceDate: input.invoiceDate, periodStart: input.periodStart, periodEnd: input.periodEnd,
        dueAt: input.invoiceDate + context.authority.paymentTermsDays * 86_400_000,
        purchaseOrderNumber: input.purchaseOrderNumber, youngPersonReferenceSnapshot: context.reference,
        customerNameSnapshot: context.authority.name,
        customerAddressSnapshot: [context.authority.addressLine1, context.authority.addressLine2, context.authority.city, context.authority.postcode].filter(Boolean).join(", "),
        supplierSnapshot: { name: context.entity.legalName, address: [context.entity.addressLine1, context.entity.addressLine2, context.entity.city, context.entity.postcode].filter(Boolean).join(", "), companyNumber: context.entity.companyNumber, vatNumber: context.entity.vatNumber },
        subtotal: totals.net.toFixed(2), vatTotal: totals.vat.toFixed(2), total: totals.gross.toFixed(2), notes: input.notes, createdBy: ctx.user.id,
      }).$returningId();
      await tx.insert(invoiceLines).values({ invoiceId: invoice.id, feeScheduleId: input.feeScheduleId, description: input.description, quantity: input.quantity.toFixed(3), unitPrice: input.unitPrice.toFixed(2), vatRate: input.vatRate.toFixed(2), netAmount: totals.net.toFixed(2), vatAmount: totals.vat.toFixed(2), grossAmount: totals.gross.toFixed(2) });
      await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: "created", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { total: totals.gross } });
      return invoice.id;
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.draft", resourceType: "invoice", resourceId: result, sensitivity: "finance", result: "success", metadata: { total: totals.gross } });
    return { id: result, totals };
  }),

  requestApproval: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.write"); const db = await requireDb(); const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!invoice || invoice.status !== "draft") throw new Error("Only a draft can be submitted for approval"); const now = Date.now(); await db.update(invoices).set({ status: "pending_approval", approvalRequestedAt: now, approvedAt: null, approvedBy: null }).where(eq(invoices.id, invoice.id)); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.request_approval", resourceType: "invoice", resourceId: invoice.id, sensitivity: "finance", result: "success" }); return { success: true }; }),

  approve: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.issue"); const db = await requireDb(); const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!invoice || invoice.status !== "pending_approval") throw new Error("Only a pending invoice can be approved"); if (invoice.createdBy === ctx.user.id) throw new Error("A different authorised user must approve this invoice"); const now = Date.now(); await db.transaction(async tx => { await tx.update(invoices).set({ approvedAt: now, approvedBy: ctx.user.id }).where(eq(invoices.id, invoice.id)); await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: "approved", occurredAt: now, actorUserId: ctx.user.id }); }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.approve", resourceType: "invoice", resourceId: invoice.id, sensitivity: "finance", result: "success" }); return { success: true }; }),

  issue: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.issue");
    const db = await requireDb();
    const invoiceNumber = await db.transaction(async tx => {
      const [entity] = await tx.select().from(entities).where(eq(entities.id, input.entityId)).limit(1);
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1);
      if (!entity || !invoice || invoice.status !== "pending_approval" || !invoice.approvedAt) throw new Error("The invoice must be independently approved before issue");
      const number = formatInvoiceNumber(entity.invoicePrefix, entity.nextInvoiceNumber);
      const bankSnapshot = entity.bankAccountName ? encryptSensitive(JSON.stringify({ accountName: entity.bankAccountName, sortCode: decryptSensitive(entity.bankSortCodeCiphertext), accountNumber: decryptSensitive(entity.bankAccountNumberCiphertext) })) : null;
      await tx.update(entities).set({ nextInvoiceNumber: entity.nextInvoiceNumber + 1 }).where(eq(entities.id, entity.id));
      await tx.update(invoices).set({ invoiceNumber: number, status: "issued", issuedAt: Date.now(), issuedBy: ctx.user.id, bankDetailsSnapshotCiphertext: bankSnapshot }).where(eq(invoices.id, invoice.id));
      await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: "issued", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { invoiceNumber: number } });
      return number;
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.issue", resourceType: "invoice", resourceId: input.invoiceId, sensitivity: "finance", result: "success", metadata: { invoiceNumber } });
    return { invoiceNumber };
  }),

  recordPayment: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive(), amount: z.number().positive(), receivedAt: z.number().int(), reference: z.string().max(160).optional(), notes: z.string().max(2000).optional() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.write");
    const db = await requireDb();
    const result = await db.transaction(async tx => {
      const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1);
      if (!invoice || !["issued", "sent", "part_paid", "overdue", "disputed"].includes(invoice.status)) throw new Error("Payment cannot be allocated to this invoice state");
      const [payment] = await tx.insert(payments).values({ entityId: input.entityId, invoiceId: input.invoiceId, receivedAt: input.receivedAt, amount: input.amount.toFixed(2), reference: input.reference, notes: input.notes, recordedBy: ctx.user.id }).$returningId();
      const amountPaid = Math.min(Number(invoice.total), Number(invoice.amountPaid) + input.amount);
      await tx.update(invoices).set({ amountPaid: amountPaid.toFixed(2), status: amountPaid >= Number(invoice.total) ? "paid" : "part_paid", reconciliationStatus: amountPaid >= Number(invoice.total) ? "reconciled" : "part_reconciled" }).where(eq(invoices.id, input.invoiceId));
      await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: input.invoiceId, eventType: "payment", occurredAt: input.receivedAt, actorUserId: ctx.user.id, metadata: { paymentId: payment.id, amount: input.amount, reference: input.reference ?? null } });
      return { paymentId: payment.id, amountPaid, balance: Math.max(0, Number(invoice.total) - amountPaid) };
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "payment.allocate", resourceType: "invoice", resourceId: input.invoiceId, sensitivity: "finance", result: "success", metadata: { amount: input.amount } });
    return result;
  }),

  markDelivered: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive(), method: z.enum(["secure_link", "email", "portal", "manual"]), reference: z.string().min(3).max(220) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.write"); const db = await requireDb(); const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!invoice || !["issued", "sent", "part_paid", "overdue"].includes(invoice.status)) throw new Error("Only an issued invoice can be marked delivered"); const now = Date.now(); await db.transaction(async tx => { await tx.update(invoices).set({ status: invoice.status === "issued" ? "sent" : invoice.status, sentAt: now, deliveryMethod: input.method, deliveryReference: input.reference }).where(eq(invoices.id, invoice.id)); await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: "delivered", occurredAt: now, actorUserId: ctx.user.id, metadata: { method: input.method, reference: input.reference } }); }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.delivered", resourceType: "invoice", resourceId: input.invoiceId, sensitivity: "finance", result: "success", metadata: { method: input.method } }); return { success: true }; }),

  setDispute: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive(), action: z.enum(["open", "resolve"]), notes: z.string().min(5).max(4000) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.write"); const db = await requireDb(); const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!invoice) throw new Error("Invoice not found"); const now = Date.now(); const status = input.action === "open" ? "disputed" : Number(invoice.amountPaid) >= Number(invoice.total) ? "paid" : Number(invoice.amountPaid) > 0 ? "part_paid" : invoice.sentAt ? "sent" : "issued"; await db.transaction(async tx => { await tx.update(invoices).set({ status, disputeOpenedAt: input.action === "open" ? now : invoice.disputeOpenedAt, disputeResolvedAt: input.action === "resolve" ? now : null, notes: [invoice.notes, input.notes].filter(Boolean).join("\n\n") }).where(eq(invoices.id, invoice.id)); await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: input.action === "open" ? "disputed" : "dispute_resolved", occurredAt: now, actorUserId: ctx.user.id, metadata: { notes: input.notes } }); }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: `invoice.dispute_${input.action}`, resourceType: "invoice", resourceId: input.invoiceId, sensitivity: "finance", result: "success" }); return { success: true }; }),

  issueCredit: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive(), netAmount: z.number().positive(), vatAmount: z.number().min(0), reason: z.string().min(5).max(4000) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.issue"); const db = await requireDb(); const result = await db.transaction(async tx => { const [invoice] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!invoice || !invoice.invoiceNumber || !["issued", "sent", "part_paid", "paid", "overdue", "disputed"].includes(invoice.status)) throw new Error("An issued invoice is required for a credit note"); const existing = await tx.select({ id: creditNotes.id }).from(creditNotes).where(eq(creditNotes.invoiceId, invoice.id)); const total = input.netAmount + input.vatAmount; const issuedCredits = await tx.select().from(creditNotes).where(and(eq(creditNotes.invoiceId, invoice.id), eq(creditNotes.status, "issued"))); const previousTotal = issuedCredits.reduce((sum, item) => sum + Number(item.total), 0); if (previousTotal + total > Number(invoice.total)) throw new Error("Credits cannot exceed the original invoice total"); const creditNumber = `CR-${invoice.invoiceNumber}-${String(existing.length + 1).padStart(2, "0")}`; const now = Date.now(); const [credit] = await tx.insert(creditNotes).values({ entityId: input.entityId, invoiceId: invoice.id, creditNumber, creditDate: now, reason: input.reason, netAmount: input.netAmount.toFixed(2), vatAmount: input.vatAmount.toFixed(2), total: total.toFixed(2), status: "issued", issuedAt: now, issuedBy: ctx.user.id, createdBy: ctx.user.id }).$returningId(); await tx.update(invoices).set({ status: previousTotal + total >= Number(invoice.total) ? "credited" : invoice.status, reconciliationStatus: previousTotal + total >= Number(invoice.total) ? "reconciled" : "exception" }).where(eq(invoices.id, invoice.id)); await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: "credit", occurredAt: now, actorUserId: ctx.user.id, metadata: { creditNoteId: credit.id, creditNumber, total } }); return { creditId: credit.id, creditNumber, total }; }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "credit_note.issue", resourceType: "invoice", resourceId: input.invoiceId, sensitivity: "finance", result: "success", metadata: { creditNumber: result.creditNumber, total: result.total } }); return result; }),

  reissueDraft: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive(), invoiceDate: z.number().int() })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.write"); const db = await requireDb(); const result = await db.transaction(async tx => { const [source] = await tx.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!source || !["credited", "disputed", "void"].includes(source.status)) throw new Error("Credit, dispute or void the original before reissuing"); const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, source.id)); const [draft] = await tx.insert(invoices).values({ entityId: source.entityId, localAuthorityId: source.localAuthorityId, placementId: source.placementId, invoiceDate: input.invoiceDate, supplyDate: source.supplyDate, periodStart: source.periodStart, periodEnd: source.periodEnd, dueAt: source.dueAt ? input.invoiceDate + Math.max(0, source.dueAt - source.invoiceDate) : null, purchaseOrderNumber: source.purchaseOrderNumber, youngPersonReferenceSnapshot: source.youngPersonReferenceSnapshot, customerNameSnapshot: source.customerNameSnapshot, customerAddressSnapshot: source.customerAddressSnapshot, supplierSnapshot: source.supplierSnapshot, bankDetailsSnapshotCiphertext: source.bankDetailsSnapshotCiphertext, subtotal: source.subtotal, vatTotal: source.vatTotal, total: source.total, notes: `Reissued from ${source.invoiceNumber ?? `draft #${source.id}`}`, createdBy: ctx.user.id }).$returningId(); if (lines.length) await tx.insert(invoiceLines).values(lines.map(line => ({ invoiceId: draft.id, feeScheduleId: line.feeScheduleId, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice, vatRate: line.vatRate, netAmount: line.netAmount, vatAmount: line.vatAmount, grossAmount: line.grossAmount }))); await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: draft.id, eventType: "created", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { reissuedFromInvoiceId: source.id } }); return draft.id; }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.reissue_draft", resourceType: "invoice", resourceId: result, sensitivity: "finance", result: "success", metadata: { sourceInvoiceId: input.invoiceId } }); return { id: result }; }),

  reconcile: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive(), status: z.enum(["reconciled", "exception"]), reference: z.string().min(3).max(220) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.write"); const db = await requireDb(); const now = Date.now(); await db.transaction(async tx => { await tx.update(invoices).set({ reconciliationStatus: input.status }).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))); await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: input.invoiceId, eventType: "reconciled", occurredAt: now, actorUserId: ctx.user.id, metadata: { status: input.status, reference: input.reference } }); }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.reconcile", resourceType: "invoice", resourceId: input.invoiceId, sensitivity: "finance", result: "success", metadata: { status: input.status } }); return { success: true }; }),

  generatePdf: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read"); const db = await requireDb();
    const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!invoice || !invoice.invoiceNumber || !invoice.issuedAt) throw new Error("Issue the approved invoice before generating its PDF");
    if (invoice.pdfDocumentId) { const [version] = await db.select().from(documentVersions).where(eq(documentVersions.documentId, invoice.pdfDocumentId)).limit(1); if (version?.fileUrl) return { documentId: invoice.pdfDocumentId, url: version.fileUrl, existing: true }; }
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoice.id)); const bank = invoice.bankDetailsSnapshotCiphertext ? JSON.parse(decryptSensitive(invoice.bankDetailsSnapshotCiphertext) ?? "null") : null;
    const bytes = await renderInvoicePdf({ invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueAt: invoice.dueAt, purchaseOrderNumber: invoice.purchaseOrderNumber, supplier: (invoice.supplierSnapshot ?? {}) as Record<string, unknown>, customerName: invoice.customerNameSnapshot, customerAddress: invoice.customerAddressSnapshot, placementReference: invoice.youngPersonReferenceSnapshot, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd, lines, subtotal: Number(invoice.subtotal), vatTotal: Number(invoice.vatTotal), total: Number(invoice.total), bank });
    const fileName = `${invoice.invoiceNumber}.pdf`; const stored = await storagePut(`entities/${input.entityId}/invoices/${invoice.id}/${Date.now()}-${fileName}`, bytes, "application/pdf"); const hash = createHash("sha256").update(bytes).digest("hex");
    const documentId = await db.transaction(async tx => { const [document] = await tx.insert(documents).values({ entityId: input.entityId, title: `Invoice ${invoice.invoiceNumber}`, documentType: "generated", classification: "finance", status: "approved", currentVersion: 1, retentionBasis: "Finance and VAT record retention policy", createdBy: ctx.user.id }).$returningId(); await tx.insert(documentVersions).values({ documentId: document.id, version: 1, fileKey: stored.key, fileUrl: stored.url, fileName, mimeType: "application/pdf", sizeBytes: bytes.length, contentHash: hash, scanStatus: "clean", approvedAt: Date.now(), approvedBy: ctx.user.id, createdBy: ctx.user.id }); await tx.update(invoices).set({ pdfDocumentId: document.id }).where(eq(invoices.id, invoice.id)); await tx.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: "document_generated", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { documentId: document.id, contentHash: hash } }); return document.id; });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.pdf_generate", resourceType: "invoice", resourceId: invoice.id, sensitivity: "finance", result: "success", metadata: { documentId, contentHash: hash } }); return { documentId, url: stored.url, existing: false };
  }),

  createSecureLink: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive(), recipientEmail: z.string().email().optional(), expiresInDays: z.number().int().min(1).max(30).default(7), maxViews: z.number().int().min(1).max(50).default(5) })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.write"); const db = await requireDb(); const [invoice] = await db.select().from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.entityId, input.entityId))).limit(1); if (!invoice?.pdfDocumentId) throw new Error("Generate the invoice PDF before creating a secure link"); const token = randomBytes(32).toString("base64url"); const expiresAt = Date.now() + input.expiresInDays * 86_400_000; const [link] = await db.insert(secureLinks).values({ entityId: input.entityId, invoiceId: invoice.id, documentId: invoice.pdfDocumentId, tokenHash: hashSecureToken(token), recipientEmail: input.recipientEmail, expiresAt, maxViews: input.maxViews, createdBy: ctx.user.id }).$returningId(); await db.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: invoice.id, eventType: "secure_link_created", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { secureLinkId: link.id, recipientEmail: input.recipientEmail ?? null, expiresAt, maxViews: input.maxViews } }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.secure_link_create", resourceType: "invoice", resourceId: invoice.id, sensitivity: "finance", result: "success", metadata: { secureLinkId: link.id, expiresAt } }); return { id: link.id, url: `/invoice-share/${token}`, expiresAt }; }),

  secureLinks: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), invoiceId: z.number().int().positive() })).query(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.read"); const db = await requireDb(); return db.select().from(secureLinks).where(and(eq(secureLinks.entityId, input.entityId), eq(secureLinks.invoiceId, input.invoiceId))).orderBy(asc(secureLinks.createdAt)); }),

  revokeSecureLink: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), id: z.number().int().positive() })).mutation(async ({ ctx, input }) => { await assertEntityCapability(ctx.user.id, input.entityId, "finance.write"); const db = await requireDb(); const [link] = await db.select().from(secureLinks).where(and(eq(secureLinks.id, input.id), eq(secureLinks.entityId, input.entityId))).limit(1); if (!link?.invoiceId) throw new Error("Invoice delivery link not found"); await db.update(secureLinks).set({ revokedAt: Date.now() }).where(eq(secureLinks.id, link.id)); await db.insert(invoiceEvents).values({ entityId: input.entityId, invoiceId: link.invoiceId, eventType: "secure_link_revoked", occurredAt: Date.now(), actorUserId: ctx.user.id, metadata: { secureLinkId: link.id } }); await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "invoice.secure_link_revoke", resourceType: "invoice", resourceId: link.invoiceId, sensitivity: "finance", result: "success", metadata: { secureLinkId: link.id } }); return { success: true }; }),

  resolveSecureLink: publicProcedure.input(z.object({ token: z.string().min(20).max(200) })).query(async ({ input }) => { const db = await requireDb(); const now = Date.now(); const result = await db.transaction(async tx => { const [link] = await tx.select().from(secureLinks).where(eq(secureLinks.tokenHash, hashSecureToken(input.token))).limit(1); if (!link?.invoiceId || !link.documentId || !isSecureLinkUsable(link, now)) throw new TRPCError({ code: "NOT_FOUND", message: "This invoice link is invalid, expired, revoked or has reached its view limit" }); const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, link.invoiceId)).limit(1); const [version] = await tx.select().from(documentVersions).where(eq(documentVersions.documentId, link.documentId)).limit(1); if (!invoice || !version?.fileUrl) throw new TRPCError({ code: "NOT_FOUND", message: "Invoice document is unavailable" }); await tx.update(secureLinks).set({ viewCount: link.viewCount + 1, lastViewedAt: now }).where(eq(secureLinks.id, link.id)); await tx.insert(invoiceEvents).values({ entityId: link.entityId, invoiceId: invoice.id, eventType: "secure_link_viewed", occurredAt: now, metadata: { secureLinkId: link.id, view: link.viewCount + 1 } }); return { linkId: link.id, entityId: link.entityId, invoice: { invoiceNumber: invoice.invoiceNumber, invoiceDate: invoice.invoiceDate, dueAt: invoice.dueAt, customerName: invoice.customerNameSnapshot, reference: invoice.youngPersonReferenceSnapshot, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd, total: Number(invoice.total), status: invoice.status }, fileUrl: version.fileUrl, expiresAt: link.expiresAt, remainingViews: link.maxViews === null ? null : Math.max(0, link.maxViews - link.viewCount - 1) }; }); await writeAuditEvent({ actorType: "secure_link", entityId: result.entityId, action: "invoice.secure_link_view", resourceType: "invoice", resourceId: result.invoice.invoiceNumber ?? undefined, sensitivity: "finance", result: "allowed", metadata: { secureLinkId: result.linkId } }); return result; }),

  generateStatementPdf: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), localAuthorityId: z.number().int().positive().optional(), startAt: z.number().int(), endAt: z.number().int() })).mutation(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read");
    const db = await requireDb(); const statement = await calculateStatement(input);
    const [entity] = await db.select().from(entities).where(eq(entities.id, input.entityId)).limit(1);
    if (!entity) throw new TRPCError({ code: "NOT_FOUND", message: "The selected company could not be found." });
    const authority = input.localAuthorityId ? (await db.select().from(localAuthorities).where(and(eq(localAuthorities.id, input.localAuthorityId), eq(localAuthorities.entityId, input.entityId))).limit(1))[0] : null;
    if (input.localAuthorityId && !authority) throw new TRPCError({ code: "FORBIDDEN", message: "The selected Local Authority does not belong to this company." });
    const bytes = await renderStatementPdf({ entityName: entity.legalName, authorityName: authority?.name ?? "All authorised Local Authorities", startAt: statement.startAt, endAt: statement.endAt, openingBalance: statement.openingBalance, closingBalance: statement.closingBalance, rows: statement.rows });
    const fileName = `statement-${input.startAt}-${input.endAt}-${Date.now()}.pdf`; const stored = await storagePut(`entities/${input.entityId}/statements/${Date.now()}-${fileName}`, bytes, "application/pdf"); const contentHash = createHash("sha256").update(bytes).digest("hex");
    const archive = await db.transaction(async tx => {
      const [document] = await tx.insert(documents).values({ entityId: input.entityId, title: `Statement of account — ${authority?.name ?? "All Local Authorities"} — ${new Date(input.startAt).toLocaleDateString("en-GB")} to ${new Date(input.endAt).toLocaleDateString("en-GB")}`, documentType: "generated", classification: "finance", status: "approved", currentVersion: 1, retentionBasis: "Finance and VAT record retention policy", createdBy: ctx.user.id }).$returningId();
      await tx.insert(documentVersions).values({ documentId: document.id, version: 1, fileKey: stored.key, fileUrl: stored.url, fileName, mimeType: "application/pdf", sizeBytes: bytes.length, contentHash, scanStatus: "clean", approvedAt: Date.now(), approvedBy: ctx.user.id, createdBy: ctx.user.id });
      const [archive] = await tx.insert(statementArchives).values({ entityId: input.entityId, localAuthorityId: input.localAuthorityId, documentId: document.id, generatedBy: ctx.user.id, startAt: input.startAt, endAt: input.endAt, openingBalance: statement.openingBalance.toFixed(2), closingBalance: statement.closingBalance.toFixed(2), contentHash }).$returningId();
      return { id: archive.id, documentId: document.id };
    });
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "finance.statement.pdf_generate", resourceType: "statement_archive", resourceId: archive.id, sensitivity: "finance", result: "success", metadata: { documentId: archive.documentId, localAuthorityId: input.localAuthorityId ?? null, startAt: input.startAt, endAt: input.endAt, contentHash } });
    return { ...archive, url: stored.url, contentHash };
  }),

  statementArchive: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), localAuthorityId: z.number().int().positive().optional(), startAt: z.number().int().optional(), endAt: z.number().int().optional() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read"); const db = await requireDb();
    const clauses = [eq(statementArchives.entityId, input.entityId)]; if (input.localAuthorityId) clauses.push(eq(statementArchives.localAuthorityId, input.localAuthorityId)); if (input.startAt) clauses.push(gte(statementArchives.endAt, input.startAt)); if (input.endAt) clauses.push(lte(statementArchives.startAt, input.endAt));
    const rows = await db.select({ archive: statementArchives, document: documents, version: documentVersions, authorityName: localAuthorities.name }).from(statementArchives).innerJoin(documents, eq(documents.id, statementArchives.documentId)).innerJoin(documentVersions, eq(documentVersions.documentId, documents.id)).leftJoin(localAuthorities, eq(localAuthorities.id, statementArchives.localAuthorityId)).where(and(...clauses)).orderBy(desc(statementArchives.createdAt)).limit(100);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "finance.statement_archive.read", resourceType: "statement_archive", sensitivity: "finance", result: "allowed", metadata: { localAuthorityId: input.localAuthorityId ?? null } });
    return rows.map(row => ({ id: row.archive.id, localAuthorityId: row.archive.localAuthorityId, authorityName: row.authorityName ?? "All authorised Local Authorities", documentId: row.archive.documentId, title: row.document.title, startAt: row.archive.startAt, endAt: row.archive.endAt, openingBalance: Number(row.archive.openingBalance), closingBalance: Number(row.archive.closingBalance), contentHash: row.archive.contentHash, createdAt: row.archive.createdAt, url: row.version.fileUrl, fileName: row.version.fileName }));
  }),

  statement: protectedProcedure.input(z.object({ entityId: z.number().int().positive(), localAuthorityId: z.number().int().positive().optional(), startAt: z.number().int().optional(), endAt: z.number().int().optional() })).query(async ({ ctx, input }) => {
    await assertEntityCapability(ctx.user.id, input.entityId, "finance.read");
    const db = await requireDb(); const now = Date.now(); const endAt = input.endAt ?? now; const startAt = input.startAt ?? endAt - 365 * 86_400_000;
    assertStatementRange(startAt, endAt);
    const base = input.localAuthorityId ? and(eq(invoices.entityId, input.entityId), eq(invoices.localAuthorityId, input.localAuthorityId), lte(invoices.invoiceDate, endAt)) : and(eq(invoices.entityId, input.entityId), lte(invoices.invoiceDate, endAt));
    const allRows = await db.select().from(invoices).where(base);
    const invoiceIds = allRows.map(row => row.id); const [creditRows, paymentRows] = invoiceIds.length ? await Promise.all([db.select().from(creditNotes).where(or(...invoiceIds.map(id => eq(creditNotes.invoiceId, id)))), db.select().from(payments).where(or(...invoiceIds.map(id => eq(payments.invoiceId, id))))]) : [[], []];
    const balanceAt = (invoice: typeof allRows[number], at: number) => {
      const paid = paymentRows.filter(item => item.invoiceId === invoice.id && item.receivedAt <= at).reduce((sum, item) => sum + Number(item.amount), 0);
      const credited = creditRows.filter(item => item.invoiceId === invoice.id && item.status === "issued" && item.creditDate <= at).reduce((sum, item) => sum + Number(item.total), 0);
      return Math.max(0, Number(invoice.total) - paid - credited);
    };
    const openingBalance = allRows.filter(row => row.invoiceDate < startAt && row.status !== "void").reduce((sum, row) => sum + balanceAt(row, startAt - 1), 0);
    const statementRows = allRows.filter(row => row.invoiceDate >= startAt && row.status !== "void").map(invoice => {
      const paymentsInRange = paymentRows.filter(item => item.invoiceId === invoice.id && item.receivedAt >= startAt && item.receivedAt <= endAt).reduce((sum, item) => sum + Number(item.amount), 0);
      const credited = creditRows.filter(item => item.invoiceId === invoice.id && item.status === "issued" && item.creditDate <= endAt).reduce((sum, item) => sum + Number(item.total), 0);
      const balance = balanceAt(invoice, endAt); const overdueDays = invoice.dueAt && balance > 0 ? Math.max(0, Math.floor((endAt - invoice.dueAt) / 86_400_000)) : 0;
      const agingBucket = balance === 0 ? "settled" : overdueDays === 0 ? "current" : overdueDays <= 30 ? "1_30" : overdueDays <= 60 ? "31_60" : overdueDays <= 90 ? "61_90" : "90_plus";
      return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, localAuthorityId: invoice.localAuthorityId, invoiceDate: invoice.invoiceDate, dueAt: invoice.dueAt, status: invoice.status, total: Number(invoice.total), paid: paymentsInRange, credited, balance, overdueDays, agingBucket, reconciliationStatus: invoice.reconciliationStatus };
    });
    const closingBalance = allRows.filter(row => row.status !== "void").reduce((sum, row) => sum + balanceAt(row, endAt), 0);
    await writeAuditEvent({ actorUserId: ctx.user.id, entityId: input.entityId, action: "finance.statement.read", resourceType: "statement", sensitivity: "finance", result: "allowed", metadata: { localAuthorityId: input.localAuthorityId ?? null, startAt, endAt } });
    return { startAt, endAt, openingBalance, closingBalance, rows: statementRows };
  }),
});
