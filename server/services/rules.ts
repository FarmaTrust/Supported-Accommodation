export type RagStatus = "green" | "amber" | "red" | "grey";

export function calculateRagStatus(dueAt: number | null | undefined, completedAt?: number | null, leadDays = 30, now = Date.now()): RagStatus {
  if (completedAt) return "green";
  if (!dueAt) return "grey";
  if (dueAt < now) return "red";
  if (dueAt <= now + leadDays * 86_400_000) return "amber";
  return "green";
}

export function calculateInvoiceLine(quantity: number, unitPrice: number, vatRate: number) {
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const net = round(quantity * unitPrice);
  const vat = round(net * (vatRate / 100));
  return { net, vat, gross: round(net + vat) };
}

export function formatInvoiceNumber(prefix: string, sequence: number) {
  if (!/^[A-Z0-9-]{2,12}$/.test(prefix)) throw new Error("Invalid invoice prefix");
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error("Invalid invoice sequence");
  return `${prefix}-${String(sequence).padStart(6, "0")}`;
}

export function classifyDeadline(dueAt: number, leadDays: number, now = Date.now()) {
  if (dueAt < now) return "overdue" as const;
  if (dueAt <= now + leadDays * 86_400_000) return "due" as const;
  return "not_due" as const;
}

export function calculateDistanceMetres(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const radius = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
