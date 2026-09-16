import { EmptyState, PageHeader, StatusBadge } from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DictationTextarea } from "@/components/DictationFields";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { ArrowRight, CalendarCheck2, CalendarClock, CheckCheck, Clock3, FileClock, ListChecks, Plus, RefreshCw, ShieldAlert, ShieldCheck, UserRoundPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function RotaControls() {
  const { entityId } = useWorkspace();
  const query = trpc.rotaControls.workspace.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId) });
  const utils = trpc.useUtils();
  const generate = trpc.rotaControls.generateSummaries.useMutation({ onSuccess: result => { toast.success(`${result.generated} worked-shift summaries generated or refreshed.`); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  const evaluate = trpc.rotaControls.evaluateWorkingTime.useMutation({ onSuccess: result => { toast.success(`${result.evaluated} assigned shifts evaluated; ${result.created} new exceptions created.`); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  const openQueue = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  if (!entityId) return <EmptyState icon={CalendarClock} title="Create an entity first" description="Advanced rota controls require an accountable entity." />;
  if (query.isLoading) return <div className="surface h-48 animate-pulse" aria-label="Loading rota controls" />;
  if (query.error || !query.data) return <EmptyState icon={ShieldCheck} title="Rota-control access restricted" description={query.error?.message ?? "Rota controls could not be loaded."} />;

  const { acknowledgements, availability, exceptions, summaries, workers, changes, policies, shifts } = query.data;
  const metrics = [
    { label: "Pending acknowledgements", value: acknowledgements.filter(item => item.status !== "acknowledged").length, note: "Review shift changes", icon: CheckCheck, target: "shift-change-alerts" },
    { label: "Availability pending", value: availability.filter(item => item.status === "active").length, note: "Leave and availability", icon: CalendarCheck2, target: "staff-availability" },
    { label: "Working-time blocks", value: exceptions.filter(item => item.severity === "block" && item.overrideStatus !== "approved").length, note: "Manager decision required", icon: ShieldAlert, target: "working-time-exceptions" },
    { label: "Payroll-ready summaries", value: summaries.filter(item => item.payrollState === "ready").length, note: "Review worked hours", icon: FileClock, target: "worked-shift-summaries" },
  ];

  return <div className="mx-auto max-w-6xl space-y-4 pb-24">
    <PageHeader eyebrow="Rota assurance" title="Availability, changes and worked shifts" description="Review actionable shift controls, staff availability and worked-hour summaries." action={<div className="flex flex-wrap gap-2"><AvailabilityDialog entityId={entityId} workers={workers} /><ChangeDialog entityId={entityId} shifts={shifts} workers={workers} /><Button variant="outline" size="sm" className="h-10 rounded-xl bg-card" onClick={() => evaluate.mutate({ entityId, from: Date.now() - 7 * 86_400_000, to: Date.now() + 60 * 86_400_000 })} disabled={evaluate.isPending}><Clock3 className="mr-1.5 h-4 w-4" />Evaluate</Button><Button size="sm" className="h-10 rounded-xl" onClick={() => generate.mutate({ entityId, from: Date.now() - 90 * 86_400_000, to: Date.now() })} disabled={generate.isPending}><RefreshCw className={`mr-1.5 h-4 w-4 ${generate.isPending ? "animate-spin" : ""}`} />Refresh</Button></div>} />
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Rota control summary">{metrics.map(metric => <button key={metric.label} type="button" onClick={() => openQueue(metric.target)} className="surface group operational-row operational-row-action rounded-xl" aria-label={`Open ${metric.label} queue`}><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><metric.icon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{metric.label}</p><p className="truncate text-xs text-muted-foreground">{metric.note}</p></div><span className="shrink-0 text-2xl font-extrabold tracking-[-0.05em]">{metric.value}</span><ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" /></button>)}</section>
    <div className="grid gap-3 xl:grid-cols-2">
      <Queue id="shift-change-alerts" title="Shift change alerts" description="Affected workers acknowledge replacements, additions and emergencies.">{acknowledgements.map(item => <Acknowledgement key={item.id} entityId={entityId} item={item} change={changes.find(change => change.id === item.shiftChangeEventId)} />)}</Queue>
      <Queue id="staff-availability" title="Staff availability" description="Availability and leave records use independent approval.">{availability.map(item => <Availability key={item.id} entityId={entityId} item={item} worker={workers.find(worker => worker.staffProfileId === item.staffProfileId)} />)}</Queue>
      <Queue id="working-time-exceptions" title="Working-time exceptions" description="Blocked exceptions require an evidence-led decision.">{exceptions.map(item => <ExceptionRow key={item.id} entityId={entityId} item={item} />)}</Queue>
      <Queue id="worked-shift-summaries" title="Worked-shift summaries" description="Name, hours and property are frozen for payroll review.">{summaries.map(item => <Summary key={item.id} entityId={entityId} item={item} />)}</Queue>
      <Queue id="working-time-policies" title="Working-time policies" description="Policies require independent activation and replace older active versions.">{policies.map(item => <Policy key={item.id} entityId={entityId} item={item} />)}</Queue>
    </div>
  </div>;
}

function Queue({ id, title, description, children }: { id: string; title: string; description: string; children: React.ReactNode[] }) {
  return <section id={id} className="surface scroll-mt-20 overflow-hidden"><div className="border-b border-border/70 px-4 py-3"><h2 className="text-base font-extrabold">{title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div><div className="divide-y divide-border/60">{children.length ? children : <p className="p-4 text-sm text-muted-foreground">No records in this queue.</p>}</div></section>;
}

function Acknowledgement({ entityId, item, change }: { entityId: number; item: any; change: any }) {
  const utils = trpc.useUtils();
  const mutation = trpc.rotaControls.acknowledgeChange.useMutation({ onSuccess: () => { toast.success("Shift change acknowledged."); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  return <article className="operational-row"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><CheckCheck className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{change?.eventType?.replaceAll("_", " ") ?? "Shift change"}</p><p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{change?.reason ?? "Review the current shift before acknowledging."}</p></div>{item.status !== "acknowledged" ? <Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg" onClick={() => mutation.mutate({ entityId, acknowledgementId: item.id })} disabled={mutation.isPending}>Acknowledge</Button> : <StatusBadge status={item.status} />}</article>;
}

function Availability({ entityId, item, worker }: { entityId: number; item: any; worker: any }) {
  const utils = trpc.useUtils();
  const mutation = trpc.rotaControls.approveAvailability.useMutation({ onSuccess: () => { toast.success("Availability independently approved."); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  return <article className="operational-row"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><CalendarCheck2 className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{worker?.name ?? `Staff ${item.staffProfileId}`} · {item.availabilityType.replaceAll("_", " ")}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{new Date(item.startsAt).toLocaleString("en-GB")} — {new Date(item.endsAt).toLocaleString("en-GB")}</p></div>{item.status === "active" ? <Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg" onClick={() => mutation.mutate({ entityId, availabilityId: item.id })} disabled={mutation.isPending}>Approve</Button> : <StatusBadge status={item.status} />}</article>;
}

function ExceptionRow({ entityId, item }: { entityId: number; item: any }) {
  const utils = trpc.useUtils();
  const mutation = trpc.rotaControls.overrideException.useMutation({ onSuccess: () => { toast.success("Working-time exception decision recorded."); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  const review = () => { const reason = prompt("Record the manager’s evidence-led override reason (minimum 20 characters)."); if (reason && reason.length >= 20) mutation.mutate({ entityId, exceptionId: item.id, decision: "approved", reason }); };
  return <article className="operational-row"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><ShieldAlert className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.exceptionType.replaceAll("_", " ")} · shift {item.shiftId}</p><p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{item.detail}</p></div>{item.overrideStatus !== "approved" ? <Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg" onClick={review} disabled={mutation.isPending}>Review</Button> : <StatusBadge status={`${item.severity}_${item.overrideStatus}`} />}</article>;
}

function Summary({ entityId, item }: { entityId: number; item: any }) {
  const utils = trpc.useUtils();
  const mutation = trpc.rotaControls.approveSummary.useMutation({ onSuccess: () => { toast.success("Worked-shift summary approved."); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  const minutes = item.approvedMinutes ?? item.clockedMinutes ?? item.scheduledMinutes;
  return <article className="operational-row"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><FileClock className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.workerNameSnapshot}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{(minutes / 60).toFixed(2)} hours · {item.propertyNameSnapshot} · {item.staffingType}</p></div>{item.payrollState === "ready" ? <Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg" onClick={() => mutation.mutate({ entityId, summaryId: item.id, approvedMinutes: minutes })} disabled={mutation.isPending}>Approve</Button> : <StatusBadge status={item.payrollState} />}</article>;
}

function Policy({ entityId, item }: { entityId: number; item: any }) {
  const utils = trpc.useUtils();
  const mutation = trpc.rotaControls.approvePolicy.useMutation({ onSuccess: () => { toast.success("Working-time policy independently activated."); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  return <article className="operational-row"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-secondary text-secondary-foreground"><ListChecks className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{item.name}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.minimumRestHours}h rest · {item.maximumShiftHours}h shift · {item.maximumWeeklyHours}h week</p></div>{item.status === "draft" ? <Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg" onClick={() => mutation.mutate({ entityId, policyId: item.id })} disabled={mutation.isPending}>Activate</Button> : <StatusBadge status={item.status} />}</article>;
}

function ChangeDialog({ entityId, shifts, workers }: { entityId: number; shifts: any[]; workers: any[] }) {
  const [open, setOpen] = useState(false); const [shiftId, setShiftId] = useState(""); const [userId, setUserId] = useState(""); const [type, setType] = useState("replacement"); const [reasonKey, setReasonKey] = useState("sickness"); const [reason, setReason] = useState(""); const utils = trpc.useUtils();
  const mutation = trpc.rotaControls.changeStaffing.useMutation({ onSuccess: () => { setOpen(false); toast.success("Staffing change applied and acknowledgement alerts created."); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" className="h-10 rounded-xl"><UserRoundPlus className="mr-1.5 h-4 w-4" />Change staffing</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Additional or replacement staff</DialogTitle><DialogDescription>Replacement updates the allocation. Additional and emergency staffing create a linked shift; affected workers must acknowledge.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><Field label="Shift"><Select value={shiftId} onValueChange={setShiftId}><SelectTrigger className="h-11"><SelectValue placeholder="Choose shift" /></SelectTrigger><SelectContent>{shifts.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.title} · {new Date(item.startsAt).toLocaleString("en-GB")}</SelectItem>)}</SelectContent></Select></Field><Choice label="Change type" value={type} onChange={setType} options={["replacement", "additional", "emergency"]} /><Field label="New / additional worker"><Select value={userId} onValueChange={setUserId}><SelectTrigger className="h-11"><SelectValue placeholder="Choose worker" /></SelectTrigger><SelectContent>{workers.map(item => <SelectItem key={item.userId} value={String(item.userId)}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Choice label="Reason" value={reasonKey} onChange={setReasonKey} options={["sickness", "annual_leave", "training", "coverage_gap", "safeguarding_need", "appointment", "emergency", "other"]} /><Field label="Manager note"><DictationTextarea value={reason} onChange={event => setReason(event.target.value)} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => mutation.mutate({ entityId, shiftId: Number(shiftId), affectedUserId: Number(userId), changeType: type as any, reasonKey: reasonKey as any, reason })} disabled={!shiftId || !userId || reason.length < 5 || mutation.isPending}>Apply and alert staff</Button></DialogFooter></DialogContent></Dialog>;
}

function AvailabilityDialog({ entityId, workers }: { entityId: number; workers: any[] }) {
  const [open, setOpen] = useState(false); const [staffId, setStaffId] = useState(""); const [type, setType] = useState("available"); const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const utils = trpc.useUtils();
  const mutation = trpc.rotaControls.createAvailability.useMutation({ onSuccess: () => { setOpen(false); toast.success("Availability record created for independent approval."); utils.rotaControls.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline" className="h-10 rounded-xl bg-card"><Plus className="mr-1.5 h-4 w-4" />Availability</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Add staff availability</DialogTitle><DialogDescription>Capture availability, leave, sickness, training or agency constraints before assigning shifts.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><Field label="Worker"><Select value={staffId} onValueChange={setStaffId}><SelectTrigger className="h-11"><SelectValue placeholder="Choose worker" /></SelectTrigger><SelectContent>{workers.map(item => <SelectItem key={item.staffProfileId} value={String(item.staffProfileId)}>{item.name}</SelectItem>)}</SelectContent></Select></Field><Choice label="Availability type" value={type} onChange={setType} options={["available", "unavailable", "preferred", "annual_leave", "sickness", "training", "agency_constraint", "other"]} /><Field label="Starts"><Input type="datetime-local" value={start} onChange={event => setStart(event.target.value)} /></Field><Field label="Ends"><Input type="datetime-local" value={end} onChange={event => setEnd(event.target.value)} /></Field></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => mutation.mutate({ entityId, staffProfileId: Number(staffId), availabilityType: type as any, startsAt: new Date(start).getTime(), endsAt: new Date(end).getTime(), preferenceLevel: "normal" })} disabled={!staffId || !start || !end || mutation.isPending}>Save availability</Button></DialogFooter></DialogContent></Dialog>;
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { return <Field label={label}><Select value={value} onValueChange={onChange}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option} value={option}>{option.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></Field>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-2"><Label>{label}</Label>{children}</div>; }
