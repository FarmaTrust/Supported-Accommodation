import { and, eq, lte, or } from "drizzle-orm";
import { creditNotes, invoices, payments } from "../../drizzle/schema";
import { getDb } from "../db";
import { assertStatementRange } from "./statementRules";

export type StatementArchiveInput = { entityId: number; localAuthorityId?: number; startAt: number; endAt: number };

export async function calculateStatement(input: StatementArchiveInput) {
  assertStatementRange(input.startAt, input.endAt);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const base = input.localAuthorityId
    ? and(eq(invoices.entityId, input.entityId), eq(invoices.localAuthorityId, input.localAuthorityId), lte(invoices.invoiceDate, input.endAt))
    : and(eq(invoices.entityId, input.entityId), lte(invoices.invoiceDate, input.endAt));
  const allRows = await db.select().from(invoices).where(base);
  const invoiceIds = allRows.map(row => row.id);
  const [creditRows, paymentRows] = invoiceIds.length
    ? await Promise.all([
      db.select().from(creditNotes).where(or(...invoiceIds.map(id => eq(creditNotes.invoiceId, id)))),
      db.select().from(payments).where(or(...invoiceIds.map(id => eq(payments.invoiceId, id)))),
    ])
    : [[], []];
  const balanceAt = (invoice: typeof allRows[number], at: number) => {
    const paid = paymentRows.filter(item => item.invoiceId === invoice.id && item.receivedAt <= at).reduce((sum, item) => sum + Number(item.amount), 0);
    const credited = creditRows.filter(item => item.invoiceId === invoice.id && item.status === "issued" && item.creditDate <= at).reduce((sum, item) => sum + Number(item.total), 0);
    return Math.max(0, Number(invoice.total) - paid - credited);
  };
  const openingBalance = allRows.filter(row => row.invoiceDate < input.startAt && row.status !== "void").reduce((sum, row) => sum + balanceAt(row, input.startAt - 1), 0);
  const rows = allRows.filter(row => row.invoiceDate >= input.startAt && row.status !== "void").map(invoice => {
    const paid = paymentRows.filter(item => item.invoiceId === invoice.id && item.receivedAt >= input.startAt && item.receivedAt <= input.endAt).reduce((sum, item) => sum + Number(item.amount), 0);
    const credited = creditRows.filter(item => item.invoiceId === invoice.id && item.status === "issued" && item.creditDate <= input.endAt).reduce((sum, item) => sum + Number(item.total), 0);
    const balance = balanceAt(invoice, input.endAt); const overdueDays = invoice.dueAt && balance > 0 ? Math.max(0, Math.floor((input.endAt - invoice.dueAt) / 86_400_000)) : 0;
    return { id: invoice.id, invoiceNumber: invoice.invoiceNumber, localAuthorityId: invoice.localAuthorityId, invoiceDate: invoice.invoiceDate, dueAt: invoice.dueAt, purchaseOrderNumber: invoice.purchaseOrderNumber, youngPersonReference: invoice.youngPersonReferenceSnapshot, status: invoice.status, total: Number(invoice.total), paid, credited, balance, overdueDays, agingBucket: balance === 0 ? "settled" : overdueDays === 0 ? "current" : overdueDays <= 30 ? "1_30" : overdueDays <= 60 ? "31_60" : overdueDays <= 90 ? "61_90" : "90_plus", reconciliationStatus: invoice.reconciliationStatus };
  });
  const closingBalance = allRows.filter(row => row.status !== "void").reduce((sum, row) => sum + balanceAt(row, input.endAt), 0);
  return { ...input, openingBalance, closingBalance, rows };
}
