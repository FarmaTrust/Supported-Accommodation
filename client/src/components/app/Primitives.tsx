import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Inbox, LucideIcon, Plus } from "lucide-react";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <header className="mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"><div className="max-w-3xl">{eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}<h1 className="page-title">{title}</h1>{description && <p className="thin-copy mt-3 max-w-2xl">{description}</p>}</div>{action && <div className="shrink-0">{action}</div>}</header>;
}

export function MetricCard({ label, value, note, icon: Icon, tone = "blue" }: { label: string; value: string | number; note?: string; icon: LucideIcon; tone?: "blue" | "blush" | "green" | "amber" }) {
  const tones = { blue: "bg-secondary text-secondary-foreground", blush: "bg-accent text-accent-foreground", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800" };
  return <div className="surface p-5"><div className={cn("mb-7 grid h-10 w-10 place-items-center rounded-xl", tones[tone])}><Icon className="h-4 w-4" /></div><p className="text-3xl font-extrabold tracking-[-0.05em]">{value}</p><p className="mt-1 text-sm font-semibold">{label}</p>{note && <p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p>}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const normal = status.replaceAll("_", " ");
  const kind = /overdue|critical|expired|uncovered|rejected/.test(status) ? "destructive" : /due_soon|warning|pending|at_risk|draft/.test(status) ? "secondary" : "outline";
  return <Badge variant={kind} className="capitalize">{normal}</Badge>;
}

export function EmptyState({ title, description, actionLabel, onAction, icon: Icon = Inbox }: { title: string; description: string; actionLabel?: string; onAction?: () => void; icon?: LucideIcon }) {
  return <div className="surface grid min-h-64 place-items-center border border-dashed border-border p-8 text-center"><div className="max-w-md"><div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-secondary-foreground"><Icon className="h-5 w-5" /></div><h2 className="text-xl font-extrabold tracking-[-0.035em]">{title}</h2><p className="thin-copy mt-2">{description}</p>{actionLabel && onAction && <Button onClick={onAction} className="mt-6 rounded-xl"><Plus className="mr-2 h-4 w-4" />{actionLabel}</Button>}</div></div>;
}

export function ActionCard({ title, description, icon: Icon, onClick, tone = "blue" }: { title: string; description: string; icon: LucideIcon; onClick: () => void; tone?: "blue" | "blush" }) {
  return <button onClick={onClick} className={cn("group flex min-h-36 w-full items-start gap-4 rounded-2xl p-5 text-left", tone === "blue" ? "bg-secondary text-secondary-foreground" : "bg-accent text-accent-foreground")}><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-card/70"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="font-extrabold tracking-[-0.025em]">{title}</p><p className="mt-1 text-xs leading-5 opacity-75">{description}</p></div><ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" /></button>;
}
