import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type QualityReviewPdfEvidence = {
  category: string;
  title: string;
  status: string;
  analysis?: string | null;
  documentAttached: boolean;
};

export type QualityReviewPdfConsultation = {
  audience: string;
  method?: string | null;
  responseStatus: string;
  summary?: string | null;
};

export type QualityReviewPdfInput = {
  entityName: string;
  propertyName?: string | null;
  title: string;
  periodStart: number;
  periodEnd: number;
  generatedAt: number;
  generatedBy: string;
  status: "draft" | "approved";
  methodology: string;
  strengths: string;
  shortfalls: string;
  outcomesSummary: string;
  youngPeopleSummary: string;
  consultationSummary: string;
  managementEvaluation: string;
  evidence: QualityReviewPdfEvidence[];
  consultations: QualityReviewPdfConsultation[];
};

const pageSize: [number, number] = [595.28, 841.89];
const left = 48;
const right = 547;
const contentWidth = right - left;
const ink = rgb(0.075, 0.09, 0.13);
const muted = rgb(0.36, 0.4, 0.47);
const blue = rgb(0.1, 0.32, 0.74);
const green = rgb(0.08, 0.34, 0.17);
const paleBlue = rgb(0.9, 0.94, 1);
const paleAmber = rgb(1, 0.95, 0.84);
const paleGreen = rgb(0.9, 0.97, 0.93);
const edge = rgb(0.82, 0.85, 0.89);

function date(value: number) {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC" });
}

function dateTime(value: number) {
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

function readable(value?: string | null) {
  return value ? value.replaceAll("_", " ") : "Not recorded";
}

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

export async function renderQualityReviewPdf(input: QualityReviewPdfInput) {
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
  const draw = (value: string, x = left, size = 9, font = regular, color = ink) => page.drawText(value, { x, y, size, font, color });
  const paragraph = (value: string, size = 9, font = regular, color = ink) => {
    for (const line of wrap(font, value, size, contentWidth)) { ensure(size + 7); draw(line, left, size, font, color); y -= size + 4; }
  };
  const section = (title: string) => { ensure(34); page.drawRectangle({ x: left, y: y - 20, width: contentWidth, height: 20, color: ink }); draw(title.toUpperCase(), left + 10, 8, bold, rgb(1, 1, 1)); y -= 30; };
  const reportField = (title: string, value: string) => { section(title); paragraph(value || "No narrative has been recorded.", 8.8); y -= 6; };

  newPage();
  draw("QUALITY OF SUPPORT REVIEW", left, 18, bold); y -= 22;
  draw(input.title, left, 10, regular, muted); y -= 18;
  page.drawRectangle({ x: left, y: y - 70, width: contentWidth, height: 67, color: paleBlue, borderColor: edge, borderWidth: 0.5 }); y -= 17;
  draw("Review period:", left + 12, 8, bold, muted); draw(`${date(input.periodStart)} – ${date(input.periodEnd)}`, left + 110, 8.5); y -= 15;
  draw("Premise:", left + 12, 8, bold, muted); draw(input.propertyName ?? "Entity-wide review", left + 110, 8.5); y -= 15;
  draw("Prepared by:", left + 12, 8, bold, muted); draw(`${input.generatedBy} · ${dateTime(input.generatedAt)}`, left + 110, 8.5); y -= 24;
  const bannerColor = input.status === "approved" ? paleGreen : paleAmber;
  page.drawRectangle({ x: left, y: y - 34, width: contentWidth, height: 32, color: bannerColor, borderColor: edge, borderWidth: 0.5 }); y -= 14;
  draw(input.status === "approved" ? "APPROVED QUALITY REVIEW — controlled final report" : "DRAFT QUALITY REVIEW — check and amend before independent approval", left + 12, 8, bold, input.status === "approved" ? green : rgb(0.45, 0.28, 0.02)); y -= 20;

  reportField("Methodology", input.methodology);
  reportField("Strengths", input.strengths);
  reportField("Shortfalls and improvement themes", input.shortfalls);
  reportField("Outcomes summary", input.outcomesSummary);
  reportField("Young people’s views", input.youngPeopleSummary);
  reportField("Consultation summary", input.consultationSummary);
  reportField("Management evaluation", input.managementEvaluation);

  section("Consultation record");
  if (!input.consultations.length) { paragraph("No consultation entries are attached to this report.", 8.5, regular, muted); }
  for (const item of input.consultations) {
    ensure(34);
    paragraph(`${readable(item.audience)} · ${readable(item.method)} · ${readable(item.responseStatus)}`, 8.6, bold);
    if (item.summary) paragraph(item.summary, 8.2, regular, muted);
    y -= 4;
  }

  section("Evidence register");
  if (!input.evidence.length) { paragraph("No evidence entries are attached to this report.", 8.5, regular, muted); }
  for (const item of input.evidence) {
    ensure(34);
    paragraph(`${item.title} · ${readable(item.category)} · ${readable(item.status)}${item.documentAttached ? " · controlled file attached" : ""}`, 8.6, bold);
    if (item.analysis) paragraph(item.analysis, 8.2, regular, muted);
    y -= 4;
  }

  ensure(34);
  draw(`Generated ${dateTime(input.generatedAt)}. This is a fictional TEST platform record.`, left, 7.2, regular, muted);
  pages.forEach((item, index) => {
    const { width } = item.getSize();
    item.drawLine({ start: { x: left, y: 51 }, end: { x: right, y: 51 }, thickness: 0.5, color: edge });
    item.drawText("Quality of support review · controlled record", { x: left, y: 36, size: 7.2, font: regular, color: muted });
    item.drawText(`Page ${index + 1} of ${pages.length}`, { x: width - 92, y: 36, size: 7.2, font: regular, color: muted });
  });
  return pdf.save({ useObjectStreams: false });
}

export async function appendQualityReviewApproval(input: {
  stagedPdf: Uint8Array;
  entityName: string;
  title: string;
  reviewId: number;
  approvedAt: number;
  approverName: string;
  approverRole: string;
}) {
  const pdf = await PDFDocument.load(input.stagedPdf);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage(pageSize);
  const { width, height } = page.getSize();
  page.drawRectangle({ x: 0, y: height - 38, width, height: 38, color: blue });
  page.drawText(input.entityName.slice(0, 70), { x: left, y: height - 24, size: 11, font: bold, color: rgb(1, 1, 1) });
  page.drawText("INDEPENDENT APPROVAL CERTIFICATE", { x: left, y: height - 88, size: 18, font: bold, color: ink });
  page.drawText(input.title.slice(0, 90), { x: left, y: height - 112, size: 10, font: regular, color: muted });
  page.drawRectangle({ x: left, y: height - 248, width: contentWidth, height: 94, color: paleGreen, borderColor: rgb(0.58, 0.8, 0.65), borderWidth: 0.5 });
  const facts = [["Decision", "Approved for controlled release"], ["Approver", input.approverName], ["Role", readable(input.approverRole)], ["Approved at", dateTime(input.approvedAt)], ["Review reference", `QSR-${input.reviewId}`]];
  facts.forEach(([label, value], index) => {
    const lineY = height - 178 - index * 16;
    page.drawText(`${label}:`, { x: left + 14, y: lineY, size: 8.5, font: bold, color: muted });
    page.drawText(value, { x: left + 124, y: lineY, size: 8.5, font: regular, color: ink });
  });
  page.drawText("The approved PDF preserves the draft report as reviewed at the stated time. It does not alter source evidence or consultation records.", { x: left, y: height - 286, size: 8.3, font: regular, color: muted });
  page.drawLine({ start: { x: left, y: 51 }, end: { x: right, y: 51 }, thickness: 0.5, color: edge });
  page.drawText("Quality of support review · fictional TEST platform", { x: left, y: 36, size: 7.2, font: regular, color: muted });
  page.drawText(`Approval page ${pdf.getPageCount()} of ${pdf.getPageCount()}`, { x: width - 112, y: 36, size: 7.2, font: regular, color: muted });
  return pdf.save({ useObjectStreams: false });
}

export function qualityReviewPdfFileName(reviewId: number, state: "draft" | "approved", timestamp: number) {
  const day = new Date(timestamp).toISOString().slice(0, 10);
  return `quality-support-review-${reviewId}-${state}-${day}.pdf`;
}
