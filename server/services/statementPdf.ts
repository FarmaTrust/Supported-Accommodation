import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type StatementPdfInput = {
  entityName: string; authorityName: string; startAt: number; endAt: number; openingBalance: number; closingBalance: number;
  rows: Array<{ invoiceNumber: string | null; invoiceDate: number; dueAt: number | null; purchaseOrderNumber?: string | null; youngPersonReference?: string | null; total: number; paid: number; credited: number; balance: number; status: string }>;
};
const ink = rgb(0.08, 0.1, 0.13); const muted = rgb(0.36, 0.4, 0.47); const blue = rgb(0.15, 0.38, 0.86); const pale = rgb(0.88, 0.93, 0.99);
const date = (value: number) => new Date(value).toLocaleDateString("en-GB"); const money = (value: number) => `£${value.toFixed(2)}`;
function write(page: PDFPage, font: PDFFont, value: string, x: number, y: number, size = 9, color = ink) { page.drawText(value.slice(0, 90), { x, y, size, font, color }); }

export async function renderStatementPdf(input: StatementPdfInput) {
  const pdf = await PDFDocument.create(); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]); let y = 690;
  const header = () => { const { width } = page.getSize(); page.drawRectangle({ x: 0, y: 806, width, height: 36, color: blue }); write(page, bold, input.entityName, 48, 770, 18); write(page, bold, "STATEMENT OF ACCOUNT", 360, 770, 14); write(page, regular, `Customer: ${input.authorityName}`, 48, 741, 10, muted); write(page, regular, `Period: ${date(input.startAt)} – ${date(input.endAt)}`, 48, 725, 9, muted); page.drawRectangle({ x: 48, y: 661, width: 498, height: 42, color: pale }); write(page, bold, `Opening balance  ${money(input.openingBalance)}`, 62, 682, 10); write(page, bold, `Closing balance  ${money(input.closingBalance)}`, 315, 682, 10); y = 635; page.drawRectangle({ x: 48, y: y, width: 498, height: 22, color: ink }); [["Invoice", 58], ["Date", 145], ["PO / reference", 215], ["Status", 375], ["Balance", 468]].forEach(([label, x]) => write(page, bold, String(label), Number(x), y + 7, 8, rgb(1, 1, 1))); };
  header();
  for (const row of input.rows) { if (y < 84) { page = pdf.addPage([595.28, 841.89]); header(); } y -= 29; page.drawLine({ start: { x: 48, y }, end: { x: 546, y }, thickness: 0.5, color: rgb(0.84, 0.86, 0.88) }); write(page, bold, row.invoiceNumber ?? "Draft", 58, y + 10, 8.5); write(page, regular, date(row.invoiceDate), 145, y + 10, 8.5); write(page, regular, `${row.purchaseOrderNumber ? `PO ${row.purchaseOrderNumber}` : "No PO"} · ${row.youngPersonReference ?? "No placement ref"}`, 215, y + 10, 8); write(page, regular, row.status.replaceAll("_", " "), 375, y + 10, 8); write(page, bold, money(row.balance), 468, y + 10, 8.5); }
  write(page, regular, "Generated from finance records at the selected date range. Use secure delivery controls for Local Authority distribution.", 48, 42, 7.5, muted);
  return pdf.save();
}
