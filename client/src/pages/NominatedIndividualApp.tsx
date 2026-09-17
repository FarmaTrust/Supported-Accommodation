import { EmptyState, PageHeader } from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowRight, Building2, ClipboardCheck, FileWarning, Landmark, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";

export default function NominatedIndividualApp() {
  const { entityId } = useWorkspace();
  const [, setLocation] = useLocation();
  const summary = trpc.nominatedIndividual.summary.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId), retry: false });

  if (!entityId) return <EmptyState icon={Landmark} title="Choose an entity first" description="Nominated Individual oversight is always scoped to one authorised legal entity." />;
  if (summary.isLoading) return <div className="mx-auto max-w-6xl space-y-4 pb-24"><Skeleton className="h-28 rounded-3xl" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-2xl" />)}</div></div>;
  if (summary.error) return <EmptyState icon={ShieldCheck} title="Nominated Individual access required" description="This aggregate governance workspace is available only to an approved Owner/Nominated Individual or platform administrator. Individual young-person, staff, finance and safeguarding narratives are not displayed here." />;
  const data = summary.data!;
  const cards: Array<{ label: string; value: number; detail: string; icon: typeof Building2; path: string; tone: "blue" | "amber" | "red" }> = [
    { label: "Active properties", value: data.counts.activeProperties, detail: "Operational property count", icon: Building2, path: "/properties", tone: "blue" },
    { label: "High-risk incidents", value: data.counts.openHighRiskIncidents, detail: "Open high or critical items", icon: AlertTriangle, path: data.links.safeguarding, tone: "red" },
    { label: "Overdue compliance", value: data.counts.overdueCompliance, detail: "Items past their due date", icon: FileWarning, path: data.links.compliance, tone: "amber" },
    { label: "Compliance due soon", value: data.counts.complianceDueSoon, detail: "Within the configured alert window", icon: ShieldCheck, path: data.links.compliance, tone: "amber" },
    { label: "Overdue work plans", value: data.counts.overdueWorkPlans, detail: "Actions requiring governance attention", icon: ClipboardCheck, path: data.links.workPlans, tone: "red" },
    { label: "Quality reviews due", value: data.counts.qualityReviewsDue, detail: "Due in the next 30 days", icon: ClipboardCheck, path: data.links.quality, tone: "blue" },
  ];
  return <div className="mx-auto max-w-6xl pb-24">
    <PageHeader eyebrow="Nominated Individual App" title={`${data.entity.name} assurance view`} description="Aggregate executive oversight for the selected entity. Use each summary to open the authoritative workspace. Individual resident, staff, financial and safeguarding narrative remains restricted." />
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Nominated Individual governance summary">
      {cards.map(card => <SummaryAction key={card.label} {...card} onClick={() => setLocation(card.path)} />)}
    </section>
    <section className="surface mt-5 overflow-hidden">
      <div className="border-b border-border/70 px-4 py-3 sm:px-5"><p className="eyebrow">Governance routes</p><h2 className="mt-1 text-xl font-extrabold">Open the accountable source</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">These links open the established governed workspaces; permissions remain checked by the server for every request.</p></div>
      <div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {[{ label: "Governance & outcomes", detail: "Entity controls, outcomes and accountability evidence", path: data.links.governance }, { label: "Compliance dashboard", detail: "Certificate, registration and renewal overview", path: data.links.compliance }, { label: "Quality reviews", detail: "Scheduled assurance and service reviews", path: data.links.quality }, { label: "Work plans", detail: "Open and overdue operational actions", path: data.links.workPlans }].map(item => <button type="button" key={item.label} onClick={() => setLocation(item.path)} className="operational-row operational-row-action px-4 py-3 text-left sm:px-5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{item.label}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{item.detail}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" /></button>)}
      </div>
      <div className="border-t border-border/70 p-4 sm:px-5"><Button variant="outline" className="h-10 rounded-xl" onClick={() => setLocation("/manager-app")}>Open RSM App <ArrowRight className="ml-2 h-4 w-4" /></Button></div>
    </section>
  </div>;
}

function SummaryAction({ label, value, detail, icon: Icon, tone, onClick }: { label: string; value: number; detail: string; icon: typeof Building2; tone: "blue" | "amber" | "red"; onClick: () => void }) {
  const colours = tone === "red" ? "bg-red-100 text-red-800 border-red-200" : tone === "amber" ? "bg-amber-100 text-amber-900 border-amber-200" : "bg-secondary text-primary border-border";
  return <button type="button" onClick={onClick} className="surface group flex min-h-[5.5rem] items-center gap-3 border p-3.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${colours}`}><Icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-sm font-extrabold">{label}</p><p className="shrink-0 text-2xl font-extrabold tracking-[-0.05em]">{value}</p></div><p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">{detail}</p></div><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" /></button>;
}
