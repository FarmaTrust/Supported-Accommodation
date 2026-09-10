import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type InvoicePdfInput = {
  invoiceNumber: string; invoiceDate: number; dueAt?: number | null; purchaseOrderNumber?: string | null;
  supplier: Record<string, unknown>; customerName?: string | null; customerAddress?: string | null;
  placementReference?: string | null; periodStart: number; periodEnd: number;
  lines: Array<{ description: string; quantity: string; unitPrice: string; vatRate: string; grossAmount: string }>;
  subtotal: number; vatTotal: number; total: number; bank?: { accountName?: string | null; sortCode?: string | null; accountNumber?: string | null } | null;
};

const ink = rgb(0.08, 0.1, 0.13); const muted = rgb(0.36, 0.4, 0.47); const blue = rgb(0.15, 0.38, 0.86); const paleBlue = rgb(0.88, 0.93, 0.99); const blush = rgb(0.98, 0.89, 0.9);
const money = (value: number) => `£${value.toFixed(2)}`; const date = (value?: number | null) => value ? new Date(value).toLocaleDateString("en-GB") : "—";

function text(page: PDFPage, font: PDFFont, value: unknown, x: number, y: number, size = 10, color = ink) { page.drawText(String(value ?? ""), { x, y, size, font, color }); }
function wrap(value: string, width = 72) { const words = value.split(/\s+/); const lines: string[] = []; let current = ""; for (const word of words) { if (`${current} ${word}`.trim().length > width) { lines.push(current); current = word; } else current = `${current} ${word}`.trim(); } if (current) lines.push(current); return lines; }

export async function renderInvoicePdf(input: InvoicePdfInput) {
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595.28, 841.89]); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold); const { width } = page.getSize();
  page.drawRectangle({ x: 0, y: 806, width, height: 36, color: blue }); page.drawRectangle({ x: 420, y: 746, width: 125, height: 18, color: blush });
  text(page, bold, String(input.supplier.name ?? "Supplier"), 50, 770, 20); text(page, bold, "INVOICE", 440, 772, 24, ink); text(page, regular, String(input.supplier.address ?? ""), 50, 750, 9, muted);
  text(page, regular, `Company number ${String(input.supplier.companyNumber ?? "—")}`, 50, 732, 8.5, muted); text(page, regular, `VAT number ${String(input.supplier.vatNumber ?? "—")}`, 50, 718, 8.5, muted);
  text(page, bold, input.invoiceNumber, 440, 735, 11); text(page, regular, `Invoice date  ${date(input.invoiceDate)}`, 440, 716, 8.5, muted); text(page, regular, `Due date  ${date(input.dueAt)}`, 440, 702, 8.5, muted);
  page.drawRectangle({ x: 50, y: 610, width: 230, height: 76, color: paleBlue }); text(page, bold, "BILL TO", 64, 664, 8, blue); text(page, bold, input.customerName ?? "Authority", 64, 644, 11); wrap(input.customerAddress ?? "", 42).slice(0, 2).forEach((line, i) => text(page, regular, line, 64, 627 - i * 13, 8.5, muted));
  page.drawRectangle({ x: 300, y: 610, width: 245, height: 76, color: rgb(0.95, 0.96, 0.97) }); text(page, bold, "PLACEMENT & PERIOD", 314, 664, 8, muted); text(page, bold, input.placementReference ?? "—", 314, 644, 11); text(page, regular, `${date(input.periodStart)} – ${date(input.periodEnd)}`, 314, 627, 8.5, muted); text(page, regular, `PO ${input.purchaseOrderNumber ?? "not supplied"}`, 314, 614, 8.5, muted);
  let y = 570; page.drawRectangle({ x: 50, y, width: 495, height: 26, color: ink }); text(page, bold, "Description", 62, y + 9, 8.5, rgb(1,1,1)); text(page, bold, "Qty", 350, y + 9, 8.5, rgb(1,1,1)); text(page, bold, "Rate", 400, y + 9, 8.5, rgb(1,1,1)); text(page, bold, "Gross", 486, y + 9, 8.5, rgb(1,1,1));
  for (const line of input.lines.slice(0, 12)) { y -= 32; page.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.84,0.86,0.88) }); text(page, regular, line.description.slice(0, 55), 62, y + 11, 8.5); text(page, regular, line.quantity, 350, y + 11, 8.5); text(page, regular, money(Number(line.unitPrice)), 400, y + 11, 8.5); text(page, bold, money(Number(line.grossAmount)), 486, y + 11, 8.5); }
  const totalsY = Math.max(210, y - 48); text(page, regular, "Subtotal", 400, totalsY, 9, muted); text(page, bold, money(input.subtotal), 490, totalsY, 9); text(page, regular, "VAT", 400, totalsY - 20, 9, muted); text(page, bold, money(input.vatTotal), 490, totalsY - 20, 9); page.drawLine({ start: { x: 395, y: totalsY - 31 }, end: { x: 545, y: totalsY - 31 }, thickness: 1, color: ink }); text(page, bold, "TOTAL", 400, totalsY - 51, 11); text(page, bold, money(input.total), 485, totalsY - 51, 13, blue);
  if (input.bank?.accountName) { page.drawRectangle({ x: 50, y: 105, width: 300, height: 72, color: rgb(0.96,0.96,0.97) }); text(page, bold, "PAYMENT DETAILS", 64, 155, 8, muted); text(page, regular, input.bank.accountName, 64, 136, 9); text(page, regular, `Sort code ${input.bank.sortCode ?? "—"}   Account ${input.bank.accountNumber ?? "—"}`, 64, 119, 9); }
  text(page, regular, "Generated from an immutable issued-invoice snapshot.", 50, 54, 8, muted); page.drawRectangle({ x: 50, y: 36, width: 64, height: 4, color: blue }); page.drawRectangle({ x: 118, y: 36, width: 28, height: 4, color: blush });
  return pdf.save();
}
