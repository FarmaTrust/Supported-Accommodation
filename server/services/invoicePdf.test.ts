import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderInvoicePdf } from "./invoicePdf";

describe("invoice PDF", () => {
  it("renders a parseable one-page issued snapshot", async () => { const bytes = await renderInvoicePdf({ invoiceNumber: "INV-2026-000001", invoiceDate: Date.UTC(2026, 7, 25), dueAt: Date.UTC(2026, 8, 24), purchaseOrderNumber: "PO-100", supplier: { name: "Provider Ltd", address: "1 Example Road, London", companyNumber: "12345678", vatNumber: "GB123" }, customerName: "Example Council", customerAddress: "Civic Centre", placementReference: "YP-001", periodStart: Date.UTC(2026, 7, 1), periodEnd: Date.UTC(2026, 7, 28), lines: [{ description: "Supported accommodation fee", quantity: "1.000", unitPrice: "4000.00", vatRate: "0.00", grossAmount: "4000.00" }], subtotal: 4000, vatTotal: 0, total: 4000, bank: { accountName: "Provider Ltd", sortCode: "00-00-00", accountNumber: "12345678" } }); expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF"); const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(1); expect(bytes.length).toBeGreaterThan(1_000); });
});
