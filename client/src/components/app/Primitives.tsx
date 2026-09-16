import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Inbox, LucideIcon, Plus } from "lucide-react";

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <header className="mb-4 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between"><div className="max-w-3xl">{eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}<h1 className="page-title">{title}</h1>{description && <p className="thin-copy mt-2 max-w-2xl">{description}</p>}</div>{action && <div className="shrink-0">{action}</div>}</header>;
}

export function MetricCard({ label, value, note, icon: Icon, tone = "blue", onClick }: { label: string; value: string | number; note?: string; icon: LucideIcon; tone?: "blue" | "blush" | "green" | "amber"; onClick?: () => void }) {
  const tones = { blue: "bg-secondary text-secondary-foreground", blush: "bg-accent text-accent-foreground", green: "bg-emerald-100 text-emerald-800", amber: "bg-amber-100 text-amber-800" };
  const content = <>
    <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tones[tone])}><Icon className="h-4 w-4" /></div>
    <div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-sm font-extrabold">{label}</p><p className="shrink-0 text-2xl font-extrabold tracking-[-0.05em]">{value}</p></div>{note && <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{note}</p>}</div>
    {onClick && <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" aria-hidden="true" />}
  </>;
  const classes = "surface group flex min-h-[5.5rem] w-full items-center gap-3 p-3.5 text-left sm:min-h-24 sm:p-4";
  return onClick ? <button type="button" onClick={onClick} className={`${classes} hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`} aria-label={`Open ${label}`}>{content}</button> : <div className={classes}>{content}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const normal = status.replaceAll("_", " ");
  const kind = /overdue|critical|expired|uncovered|rejected/.test(status) ? "destructive" : /due_soon|warning|pending|at_risk|draft/.test(status) ? "secondary" : "outline";
  return <Badge variant={kind} className="capitalize">{normal}</Badge>;
}

export function EmptyState({ title, description, actionLabel, onAction, icon: Icon = Inbox }: { title: string; description: string; actionLabel?: string; onAction?: () => void; icon?: LucideIcon }) {
  return <div className="surface grid min-h-44 place-items-center border border-dashed border-border p-5 text-center sm:min-h-56 sm:p-7"><div className="max-w-md"><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl bg-secondary text-secondary-foreground"><Icon className="h-4 w-4" /></div><h2 className="text-lg font-extrabold tracking-[-0.035em]">{title}</h2><p className="thin-copy mt-1.5">{description}</p>{actionLabel && onAction && <Button onClick={onAction} size="sm" className="mt-4 rounded-xl"><Plus className="mr-2 h-4 w-4" />{actionLabel}</Button>}</div></div>;
}

export function ActionCard({ title, description, icon: Icon, onClick, tone = "blue" }: { title: string; description: string; icon: LucideIcon; onClick: () => void; tone?: "blue" | "blush" }) {
  return <button onClick={onClick} className={cn("group flex min-h-24 w-full items-start gap-3 rounded-2xl p-3.5 text-left sm:min-h-28 sm:p-4", tone === "blue" ? "bg-secondary text-secondary-foreground" : "bg-accent text-accent-foreground")}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card/70"><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="font-extrabold tracking-[-0.025em]">{title}</p><p className="mt-0.5 text-xs leading-5 opacity-75">{description}</p></div><ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-1" /></button>;
}
