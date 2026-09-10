import { EmptyState, PageHeader, StatusBadge } from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, ArrowRight, CalendarClock, ClipboardCheck, FileWarning, ShieldCheck, UsersRound, Wrench } from "lucide-react";
import { useMemo } from "react";
import { useLocation } from "wouter";

type Queue = { staffRequests: any[]; incidents: any[]; reports: any[]; propertyChecks: any[]; medicationDiscrepancies: any[]; financeDiscrepancies: any[]; safeguardingConcerns: any[]; investigations: any[] };

function count(queue: Partial<Queue> | undefined, key: keyof Queue) { return queue?.[key]?.length ?? 0; }

export default function ManagerApp() {
  const { entityId, entity } = useWorkspace();
  const [, setLocation] = useLocation();
  const queue = trpc.staffWorkspace.managerQueue.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId), retry: false });
  const shifts = trpc.operations.shifts.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId), retry: false });
  const notifications = trpc.workspace.notifications.useQuery();
  const live = useMemo(() => {
    const now = Date.now(); const items = shifts.data ?? [];
    return {
      active: items.filter(item => item.status !== "cancelled" && item.startsAt <= now && item.endsAt >= now),
      uncovered: items.filter(item => item.status !== "cancelled" && (item.coverageState === "uncovered" || !item.assignedUserId)),
      atRisk: items.filter(item => item.status !== "cancelled" && item.coverageState === "at_risk"),
    };
  }, [shifts.data]);

  if (!entityId) return <EmptyState title="Create an entity first" description="Manager oversight is scoped to an authorised legal entity, property and operational role." icon={UsersRound} />;
  if (queue.error) return <EmptyState title="Manager app restricted" description="This operational inbox is available only to authorised owners and registered managers. No team or resident details are shown without that access." icon={ShieldCheck} />;
  if (queue.isLoading || shifts.isLoading) return <ManagerSkeleton />;
  const urgent = count(queue.data, "incidents") + count(queue.data, "safeguardingConcerns") + count(queue.data, "medicationDiscrepancies") + count(queue.data, "financeDiscrepancies");
  const tasks = [
    { title: "Staff requests", count: count(queue.data, "staffRequests"), detail: "Leave, sickness, availability and profile changes awaiting a decision.", path: "/workforce", icon: UsersRound, tone: "blue" },
    { title: "Reports to review", count: count(queue.data, "reports"), detail: "Submitted key-worker reports awaiting manager review.", path: "/key-worker", icon: ClipboardCheck, tone: "green" },
    { title: "Incidents & concerns", count: urgent, detail: "Open incidents, safeguarding concerns and discrepancies requiring attention.", path: "/safeguarding", icon: AlertTriangle, tone: "red" },
    { title: "Property actions", count: count(queue.data, "propertyChecks"), detail: "Submitted checks and operational issues that need a response.", path: "/properties", icon: Wrench, tone: "amber" },
  ];
  return <div className="mx-auto max-w-6xl pb-28"><PageHeader eyebrow="Mobile manager app" title={entity ? `${entity.name} command view` : "Manager command view"} description="Act on current staffing, requests, reports and operational exceptions without creating a second source of truth." action={<Button className="rounded-xl" onClick={() => setLocation("/search?tab=notifications")}>Notifications {notifications.data?.filter(item => !item.readAt).length ? `(${notifications.data.filter(item => !item.readAt).length})` : ""}</Button>} />
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Manager operational summary">
      <SummaryCard label="On duty now" value={live.active.length} note="Scheduled active shifts" icon={UsersRound} />
      <SummaryCard label="Coverage gaps" value={live.uncovered.length} note="Open or uncovered shifts" icon={CalendarClock} tone="amber" />
      <SummaryCard label="At-risk shifts" value={live.atRisk.length} note="Rest, role or coverage warning" icon={FileWarning} tone="amber" />
      <SummaryCard label="Urgent review" value={urgent} note="Incidents and restricted concerns" icon={AlertTriangle} tone="red" />
    </section>
    <section className="mt-5 surface overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-border/70 p-5"><div><p className="eyebrow">Manager inbox</p><h2 className="mt-1 text-xl font-extrabold">Review and exception queue</h2></div><Button variant="outline" size="sm" onClick={() => setLocation("/rota")}>Open rota <ArrowRight className="ml-2 h-4 w-4" /></Button></div><div className="grid divide-y divide-border/60 sm:grid-cols-2 sm:divide-x sm:divide-y-0">{tasks.map(item => <button key={item.title} onClick={() => setLocation(item.path)} className="flex min-h-32 items-start gap-4 p-5 text-left transition-colors hover:bg-muted/60"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${item.tone === "red" ? "bg-red-100 text-red-800" : item.tone === "amber" ? "bg-amber-100 text-amber-900" : item.tone === "green" ? "bg-emerald-100 text-emerald-800" : "bg-secondary text-secondary-foreground"}`}><item.icon className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><p className="font-extrabold">{item.title}</p><span className="rounded-full bg-muted px-2.5 py-1 text-sm font-extrabold">{item.count}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p></div><ArrowRight className="mt-1 h-4 w-4 text-muted-foreground" /></button>)}</div></section>
    <section className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]"><div className="surface p-5 sm:p-6"><p className="eyebrow">Live staffing</p><h2 className="mt-1 text-xl font-extrabold">Current shift coverage</h2>{live.active.length ? <div className="mt-5 space-y-3">{live.active.slice(0, 6).map(shift => <article key={shift.id} className="flex items-center gap-3 rounded-2xl bg-muted p-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{shift.title}</p><p className="mt-1 text-xs text-muted-foreground">Property #{shift.propertyId} · ends {new Date(shift.endsAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p></div><StatusBadge status={shift.coverageState} /></article>)}</div> : <p className="thin-copy mt-5">No scheduled shifts are currently active. Open the rota to check upcoming coverage and acknowledgements.</p>}<Button variant="outline" className="mt-5 w-full rounded-xl" onClick={() => setLocation("/rota")}>View rota and time exceptions</Button></div><aside className="surface p-5 sm:p-6"><p className="eyebrow">Manager actions</p><h2 className="mt-1 text-xl font-extrabold">Open the right record</h2><div className="mt-5 grid gap-2">{[{ label: "Compliance dashboard", path: "/compliance-dashboard" }, { label: "Work plans", path: "/work-plans" }, { label: "Visitor & property log", path: "/properties" }, { label: "Quality reviews", path: "/quality-reviews" }].map(action => <Button key={action.path} variant="outline" className="h-12 justify-between rounded-xl" onClick={() => setLocation(action.path)}>{action.label}<ArrowRight className="h-4 w-4" /></Button>)}</div><p className="mt-5 text-xs leading-5 text-muted-foreground">This view routes to the established platform records; manager review and restricted-data decisions remain server-authorised.</p></aside></section>
  </div>;
}

function SummaryCard({ label, value, note, icon: Icon, tone = "blue" }: { label: string; value: number; note: string; icon: typeof UsersRound; tone?: "blue" | "amber" | "red" }) { return <article className={`surface p-5 ${tone === "red" ? "border-red-200" : tone === "amber" ? "border-amber-200" : ""}`}><div className="flex items-start justify-between gap-4"><div><p className="text-3xl font-extrabold tracking-[-0.05em]">{value}</p><p className="mt-2 text-sm font-extrabold">{label}</p></div><Icon className={`h-5 w-5 ${tone === "red" ? "text-red-700" : tone === "amber" ? "text-amber-800" : "text-primary"}`} /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{note}</p></article>; }
function ManagerSkeleton() { return <div className="mx-auto max-w-6xl space-y-5 pb-28" aria-label="Loading manager app"><Skeleton className="h-28 rounded-3xl" /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-36 rounded-2xl" />)}</div><Skeleton className="h-72 rounded-3xl" /></div>; }
