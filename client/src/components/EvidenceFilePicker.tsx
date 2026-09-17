import { Button } from "@/components/ui/button";
import { FileImage, FileText, ScanLine, Trash2, Upload } from "lucide-react";
import { useId, useRef } from "react";
import { toast } from "sonner";

export const controlledEvidenceAccept = ".jpg,.jpeg,.png,.webp,.heic,.pdf,.doc,.docx";
export const controlledEvidenceMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
export const maximumEvidenceFileBytes = 8 * 1024 * 1024;
export const maximumEvidenceFiles = 8;

const mimeTypeByExtension: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
  pdf: "application/pdf", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function normaliseEvidenceMimeType(file: File) {
  if (controlledEvidenceMimeTypes.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return mimeTypeByExtension[extension] ?? file.type;
}

export function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("The selected file could not be read."));
    reader.readAsDataURL(file);
  });
}

function readableBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(file: File) {
  return file.type.startsWith("image/") ? FileImage : FileText;
}

export function EvidenceFilePicker({
  files,
  onChange,
  label = "Supporting documents or photos",
  description = "Add scanned pages, photographs or a PDF. Each selected file is checked before it is attached.",
  disabled = false,
  required = false,
  maxFiles = maximumEvidenceFiles,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  required?: boolean;
  maxFiles?: number;
}) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const chooseFiles = (incoming: FileList | null) => {
    if (!incoming?.length) return;
    const candidates = Array.from(incoming);
    const invalid = candidates.find(file => !controlledEvidenceMimeTypes.has(normaliseEvidenceMimeType(file)) || file.size > maximumEvidenceFileBytes);
    if (invalid) {
      const message = !controlledEvidenceMimeTypes.has(normaliseEvidenceMimeType(invalid))
        ? `${invalid.name} is not an accepted image, PDF or Word document.`
        : `${invalid.name} is larger than 8 MB.`;
      toast.error("File not added", { description: message });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const unique = candidates.filter(candidate => !files.some(file => file.name === candidate.name && file.size === candidate.size && file.lastModified === candidate.lastModified));
    const next = [...files, ...unique];
    if (next.length > maxFiles) {
      toast.error("Too many files", { description: `Attach up to ${maxFiles} scanned pages or files at one time.` });
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = "";
  };

  return <section className="rounded-xl border border-dashed border-primary/30 bg-primary/5 p-3">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-extrabold"><ScanLine className="h-4 w-4 text-primary" />{label}{required ? <span className="text-destructive">*</span> : null}</label>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description} Images can be captured from a phone camera. Review the file names and pages before submission.</p>
      </div>
      <Button type="button" size="sm" variant="outline" className="h-9 shrink-0 rounded-lg bg-card" disabled={disabled} onClick={() => inputRef.current?.click()}><Upload className="mr-1.5 h-3.5 w-3.5" />Add files</Button>
    </div>
    <input ref={inputRef} id={id} type="file" accept={controlledEvidenceAccept} multiple capture="environment" className="sr-only" disabled={disabled} onChange={event => chooseFiles(event.target.files)} />
    {files.length ? <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-lg border border-border/70 bg-card">{files.map(file => {
      const Icon = fileIcon(file);
      return <li key={`${file.name}-${file.size}-${file.lastModified}`} className="flex min-h-11 items-center gap-2 px-3 py-2"><Icon className="h-4 w-4 shrink-0 text-primary" /><p className="min-w-0 flex-1 truncate text-xs font-semibold">{file.name} <span className="font-normal text-muted-foreground">· {readableBytes(file.size)}</span></p><Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:text-destructive" disabled={disabled} onClick={() => onChange(files.filter(item => item !== file))} aria-label={`Remove ${file.name}`}><Trash2 className="h-3.5 w-3.5" /></Button></li>;
    })}</ul> : <p className="mt-3 text-xs font-medium text-muted-foreground">No files selected. Accepted: JPG, PNG, WEBP, HEIC, PDF, DOC or DOCX; maximum 8 MB each.</p>}
  </section>;
}
