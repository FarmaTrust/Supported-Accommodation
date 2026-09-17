import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type RecordExportPdfSection = {
  title: string;
  records: Array<{ occurredAt?: number | null; title: string; detail?: string | null; notes?: string | null; status?: string | null }>;
};

export type RecordExportPdfInput = {
  title: string;
  entityName: string;
  propertyName?: string | null;
  placementReference?: string | null;
  preferredName?: string | null;
  rangeStart: number;
  rangeEnd: number;
  generatedAt: number;
  snapshotHash: string;
  requestedByName: string;
  approval?: { approverName: string; approverRole: string; approvedAt: number } | null;
  sections: RecordExportPdfSection[];
};

const ink = rgb(0.075, 0.09, 0.13);
const muted = rgb(0.36, 0.4, 0.47);
const blue = rgb(0.1, 0.32, 0.74);
const paleBlue = rgb(0.9, 0.94, 1);
const paleGreen = rgb(0.9, 0.97, 0.93);
const paleAmber = rgb(1, 0.95, 0.84);
const edge = rgb(0.82, 0.85, 0.89);
const pageSize: [number, number] = [595.28, 841.89];
const left = 48;
const right = 547;
const contentWidth = right - left;
const formatDate = (value?: number | null) => value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "—";
const formatPeriod = (start: number, end: number) => `${new Date(start).toLocaleDateString("en-GB", { timeZone: "UTC" })} – ${new Date(end).toLocaleDateString("en-GB", { timeZone: "UTC" })}`;
const titleCase = (value?: string | null) => value ? value.replaceAll("_", " ") : "";

function wrap(font: PDFFont, text: string, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) <= width) { line = word; continue; }
      let fragment = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(fragment + character, size) > width && fragment) { lines.push(fragment); fragment = character; }
        else fragment += character;
      }
      line = fragment;
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

export async function renderRecordExportPdf(input: RecordExportPdfInput) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const newPage = () => {
    page = pdf.addPage(pageSize);
    pages.push(page);
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: height - 38, width, height: 38, color: blue });
    page.drawText(input.entityName.slice(0, 70), { x: left, y: height - 24, size: 11, font: bold, color: rgb(1, 1, 1) });
    y = height - 62;
  };
  const ensure = (height: number) => { if (y - height < 72) newPage(); };
  const line = (value: string, x: number, size = 9, font = regular, color = ink) => page.drawText(value, { x, y, size, font, color });
  const wrapped = (value: string, x: number, size = 9, font = regular, color = ink, width = contentWidth) => {
    const lines = wrap(font, value, size, width);
    for (const valueLine of lines) { ensure(size + 7); page.drawText(valueLine, { x, y, size, font, color }); y -= size + 4; }
  };
  const metaLine = (label: string, value: string) => { ensure(18); line(`${label}:`, left, 8, bold, muted); line(value, left + 105, 8.5, regular, ink); y -= 15; };

  newPage();
  line(input.title.toUpperCase(), left, 18, bold, ink); y -= 22;
  line("Factual printable record snapshot", left, 9, regular, muted); y -= 18;
  page.drawRectangle({ x: left, y: y - 81, width: contentWidth, height: 78, color: paleBlue, borderColor: edge, borderWidth: 0.5 }); y -= 17;
  metaLine("Period", formatPeriod(input.rangeStart, input.rangeEnd));
  metaLine("Property", input.propertyName ?? "Entity-level record");
  metaLine("Young person", input.placementReference ? `${input.placementReference}${input.preferredName ? ` — ${input.preferredName}` : ""}` : "Not applicable");
  metaLine("Requested by", input.requestedByName);
  y -= 8;
  if (input.approval) {
    ensure(60);
    page.drawRectangle({ x: left, y: y - 44, width: contentWidth, height: 42, color: paleGreen, borderColor: rgb(0.58, 0.8, 0.65), borderWidth: 0.5 }); y -= 15;
    line("INDEPENDENT APPROVAL", left + 12, 8, bold, rgb(0.08, 0.34, 0.17)); y -= 13;
    line(`${input.approval.approverRole.replaceAll("_", " ")} · ${input.approval.approverName} · ${formatDate(input.approval.approvedAt)}`, left + 12, 8.5, regular, ink); y -= 24;
  } else {
    ensure(48);
    page.drawRectangle({ x: left, y: y - 34, width: contentWidth, height: 32, color: paleAmber, borderColor: rgb(0.9, 0.7, 0.25), borderWidth: 0.5 }); y -= 14;
    line("STAGED SNAPSHOT — independent approval evidence is appended before controlled release.", left + 12, 8, bold, rgb(0.45, 0.28, 0.02)); y -= 20;
  }

  for (const section of input.sections) {
    ensure(42);
    page.drawRectangle({ x: left, y: y - 20, width: contentWidth, height: 20, color: ink });
    line(section.title.toUpperCase(), left + 10, 8, bold, rgb(1, 1, 1)); y -= 30;
    if (!section.records.length) { line("No records fall within the selected date range.", left, 8.5, regular, muted); y -= 17; continue; }
    for (const record of section.records) {
      const body = [record.detail, record.notes].filter(Boolean).join("\n");
      const recordHeight = 25 + wrap(bold, record.title, 10, contentWidth - 8).length * 14 + wrap(regular, body, 8.5, contentWidth - 8).length * 12;
      ensure(Math.min(recordHeight, 180));
      wrapped(record.title, left, 10, bold, ink);
      const metadata = [formatDate(record.occurredAt), titleCase(record.status)].filter(value => value && value !== "—").join(" · ");
      if (metadata) { line(metadata, left, 7.8, regular, muted); y -= 13; }
      if (body) wrapped(body, left, 8.5, regular, ink);
      page.drawLine({ start: { x: left, y: y - 3 }, end: { x: right, y: y - 3 }, thickness: 0.5, color: edge }); y -= 13;
    }
    y -= 4;
  }
  ensure(40);
  line(`Snapshot SHA-256: ${input.snapshotHash}`, left, 7.2, regular, muted); y -= 12;
  line(`Generated: ${formatDate(input.generatedAt)} · This is a fictional TEST platform record.`, left, 7.2, regular, muted);

  pages.forEach((item, index) => {
    const { width } = item.getSize();
    item.drawLine({ start: { x: left, y: 51 }, end: { x: right, y: 51 }, thickness: 0.5, color: edge });
    item.drawText("Controlled printable record · do not treat as a real operational record", { x: left, y: 36, size: 7.2, font: regular, color: muted });
    item.drawText(`Page ${index + 1} of ${pages.length}`, { x: width - 92, y: 36, size: 7.2, font: regular, color: muted });
  });
  return pdf.save({ useObjectStreams: false });
}

/** Adds a separate, immutable approval certificate without rebuilding the staged record snapshot. */
export async function appendRecordExportApproval(input: {
  stagedPdf: Uint8Array;
  title: string;
  entityName: string;
  snapshotHash: string;
  approvedAt: number;
  approverName: string;
  approverRole: string;
  exportId: number;
}) {
  const pdf = await PDFDocument.load(input.stagedPdf);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage(pageSize);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 38, width, height: 38, color: blue });
  page.drawText(input.entityName.slice(0, 70), { x: left, y: height - 24, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText("APPROVAL CERTIFICATE", { x: left, y: height - 88, size: 18, font: bold, color: ink });
  page.drawText(input.title, { x: left, y: height - 112, size: 10, font: regular, color: muted });
  page.drawRectangle({ x: left, y: height - 270, width: contentWidth, height: 118, color: paleGreen, borderColor: rgb(0.58, 0.8, 0.65), borderWidth: 0.5 });
  const facts = [
    ["Decision", "Approved for controlled release"],
    ["Approver", input.approverName],
    ["Role", titleCase(input.approverRole)],
    ["Approved at", formatDate(input.approvedAt)],
    ["Export reference", `PRE-${input.exportId}`],
  ];
  facts.forEach(([label, value], index) => {
    const y = height - 178 - index * 18;
    page.drawText(`${label}:`, { x: left + 14, y, size: 8.5, font: bold, color: muted });
    page.drawText(value, { x: left + 118, y, size: 8.5, font: regular, color: ink });
  });
  page.drawText("This certificate releases the staged immutable snapshot identified below. It does not alter source records.", { x: left, y: height - 306, size: 8.5, font: regular, color: muted });
  page.drawText(`Snapshot SHA-256: ${input.snapshotHash}`, { x: left, y: height - 326, size: 7.5, font: regular, color: muted });
  page.drawLine({ start: { x: left, y: 51 }, end: { x: right, y: 51 }, thickness: 0.5, color: edge });
  page.drawText("Controlled printable record · fictional TEST platform", { x: left, y: 36, size: 7.2, font: regular, color: muted });
  page.drawText(`Approval page ${pdf.getPageCount()} of ${pdf.getPageCount()}`, { x: width - 112, y: 36, size: 7.2, font: regular, color: muted });
  return pdf.save({ useObjectStreams: false });
}
