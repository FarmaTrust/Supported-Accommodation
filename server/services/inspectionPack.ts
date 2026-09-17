import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { ZipFile } from "yazl";
import { storageGetSignedUrl } from "../storage";

export type InspectionPackSource = "quality_report" | "quality_evidence" | "printable_report";

export type InspectionPackFile = {
  source: InspectionPackSource;
  sourceId: number;
  reviewId?: number;
  propertyName?: string | null;
  title: string;
  fileKey: string;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  contentHash: string | null;
};

export type InspectionPackReview = {
  id: number;
  title: string;
  propertyName?: string | null;
  periodStart: number;
  periodEnd: number;
  approvedAt: number | null;
  evidenceCount: number;
};

export type InspectionPackManifest = {
  schemaVersion: 1;
  generatedAt: number;
  entityId: number;
  propertyId: number | null;
  requestedBy: number;
  packKind: "approved_quality_and_report_archive";
  counts: {
    approvedQualityReviews: number;
    qualityEvidenceFiles: number;
    otherReleasedReports: number;
    bundledFiles: number;
  };
  files: Array<Pick<InspectionPackFile, "source" | "sourceId" | "reviewId" | "title" | "fileName" | "mimeType" | "sizeBytes" | "contentHash">>;
};

const MB = 1024 * 1024;
const MAX_FILES = 250;
const MAX_PACK_BYTES = 100 * MB;
const pageSize: [number, number] = [595.28, 841.89];
const margin = 48;
const ink = rgb(0.075, 0.09, 0.13);
const muted = rgb(0.36, 0.4, 0.47);
const blue = rgb(0.1, 0.32, 0.74);
const edge = rgb(0.82, 0.85, 0.89);

function safeSegment(value: string) {
  const cleaned = value.replace(/[^a-zA-Z0-9._ -]+/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return (cleaned || "file").slice(0, 120);
}

function utcDate(value: number) {
  return new Date(value).toLocaleDateString("en-GB", { timeZone: "UTC" });
}

function wrap(font: PDFFont, text: string, size: number, width: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
    if (line) lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

export async function renderInspectionPackIndex(input: {
  entityName: string;
  propertyName?: string | null;
  generatedAt: number;
  reviews: InspectionPackReview[];
  files: InspectionPackFile[];
}) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;
  const right = pageSize[0] - margin;
  const width = right - margin;
  const newPage = () => {
    page = pdf.addPage(pageSize);
    pages.push(page);
    page.drawRectangle({ x: 0, y: pageSize[1] - 38, width: pageSize[0], height: 38, color: blue });
    page.drawText(input.entityName.slice(0, 70), { x: margin, y: pageSize[1] - 24, size: 11, font: bold, color: rgb(1, 1, 1) });
    y = pageSize[1] - 62;
  };
  const ensure = (height: number) => { if (y - height < 66) newPage(); };
  const line = (value: string, size = 9, font: PDFFont = regular, color = ink) => { page.drawText(value, { x: margin, y, size, font, color }); y -= size + 4; };
  const paragraph = (value: string, size = 9, font: PDFFont = regular, color = ink) => {
    for (const part of wrap(font, value, size, width)) { ensure(size + 6); line(part, size, font, color); }
  };
  const section = (title: string) => { ensure(28); page.drawRectangle({ x: margin, y: y - 18, width, height: 18, color: ink }); page.drawText(title.toUpperCase(), { x: margin + 9, y: y - 12, size: 7.7, font: bold, color: rgb(1, 1, 1) }); y -= 27; };

  newPage();
  line("INSPECTION PACK INDEX", 18, bold); y -= 2;
  paragraph("Controlled archive index for approved quality reviews, their reviewed evidence files, and released printable reports. The accompanying ZIP is the authoritative bundle; this index does not reproduce protected narratives.", 9.4, regular, muted); y -= 4;
  page.drawRectangle({ x: margin, y: y - 62, width, height: 60, color: rgb(0.9, 0.94, 1), borderColor: edge, borderWidth: 0.5 }); y -= 15;
  line(`Scope: ${input.propertyName ?? "Authorised entity-wide inspection archive"}`, 8.5, bold);
  line(`Created: ${new Date(input.generatedAt).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`, 8.5);
  line(`Included: ${input.reviews.length} approved quality review(s) · ${input.files.length} controlled file(s)`, 8.5);
  y -= 8;

  section("Approved quality reviews");
  if (!input.reviews.length) paragraph("No approved quality review report matched the selected authorised scope.", 8.7, regular, muted);
  for (const review of input.reviews) {
    ensure(38);
    paragraph(`QSR-${review.id} · ${review.title} · ${review.propertyName ?? "Entity-wide"}`, 8.7, bold);
    paragraph(`${utcDate(review.periodStart)}–${utcDate(review.periodEnd)} · approved ${review.approvedAt ? utcDate(review.approvedAt) : "recorded approval"} · ${review.evidenceCount} reviewed evidence item(s)`, 8.2, regular, muted);
    y -= 3;
  }

  section("Bundled files");
  if (!input.files.length) paragraph("No report or evidence file matched the selected authorised scope.", 8.7, regular, muted);
  for (const file of input.files) {
    ensure(32);
    paragraph(`${file.source.replaceAll("_", " ")} · ${file.title}`, 8.6, bold);
    paragraph(`${file.fileName} · ${file.mimeType ?? "unknown type"} · ${file.sizeBytes ? `${Math.ceil(file.sizeBytes / 1024)} KB` : "size unavailable"}${file.contentHash ? ` · SHA-256 ${file.contentHash.slice(0, 16)}…` : ""}`, 7.8, regular, muted);
    y -= 2;
  }
  ensure(22);
  paragraph("Fictional TEST platform record. Access, generation and download are audited. Do not treat this bundle as real operational evidence.", 7.4, regular, muted);
  pages.forEach((item, index) => {
    item.drawLine({ start: { x: margin, y: 51 }, end: { x: right, y: 51 }, thickness: 0.5, color: edge });
    item.drawText("Inspection pack index · controlled archive", { x: margin, y: 36, size: 7.2, font: regular, color: muted });
    item.drawText(`Page ${index + 1} of ${pages.length}`, { x: right - 52, y: 36, size: 7.2, font: regular, color: muted });
  });
  return pdf.save({ useObjectStreams: false });
}

function zipBuffer(zip: ZipFile) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}

async function fetchControlledFile(file: InspectionPackFile) {
  const url = await storageGetSignedUrl(file.fileKey);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Inspection pack source retrieval failed for ${file.source}:${file.sourceId}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (file.contentHash && createHash("sha256").update(bytes).digest("hex") !== file.contentHash) throw new Error(`Inspection pack source hash mismatch for ${file.source}:${file.sourceId}`);
  return bytes;
}

export async function createInspectionPackZip(input: {
  manifest: InspectionPackManifest;
  entityName: string;
  propertyName?: string | null;
  reviews: InspectionPackReview[];
  files: InspectionPackFile[];
}) {
  if (input.files.length > MAX_FILES) throw new Error("Inspection pack file limit exceeded");
  const declaredTotal = input.files.reduce((total, file) => total + Math.max(0, file.sizeBytes ?? 0), 0);
  if (declaredTotal > MAX_PACK_BYTES) throw new Error("Inspection pack size limit exceeded");
  const index = await renderInspectionPackIndex({ entityName: input.entityName, propertyName: input.propertyName, generatedAt: input.manifest.generatedAt, reviews: input.reviews, files: input.files });
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(index), "inspection-pack-index.pdf", { compress: true });
  zip.addBuffer(Buffer.from(JSON.stringify(input.manifest, null, 2)), "inspection-pack-manifest.json", { compress: true });
  for (let indexNumber = 0; indexNumber < input.files.length; indexNumber += 1) {
    const file = input.files[indexNumber]!;
    const bytes = await fetchControlledFile(file);
    const folder = file.source === "quality_report" ? `quality-reviews/QSR-${file.reviewId ?? file.sourceId}` : file.source === "quality_evidence" ? `quality-reviews/QSR-${file.reviewId ?? "evidence"}/evidence` : "released-reports";
    zip.addBuffer(bytes, `${folder}/${String(indexNumber + 1).padStart(3, "0")}-${safeSegment(file.fileName)}`, { compress: true });
  }
  return zipBuffer(zip);
}

export function inspectionPackFileName(jobId: number, generatedAt: number) {
  return `inspection-pack-${jobId}-${new Date(generatedAt).toISOString().slice(0, 10)}.zip`;
}

export function inspectionPackContentHash(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
