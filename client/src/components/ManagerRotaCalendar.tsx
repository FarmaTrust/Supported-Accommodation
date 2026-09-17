import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DictationTextarea } from "@/components/DictationFields";
import { useIsMobile } from "@/hooks/useMobile";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import { addDays, format, startOfWeek } from "date-fns";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, GripVertical, Move, RefreshCw, ShieldCheck, UserRoundCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type MoveProposal = { shift: any; propertyId: number; assignedUserId?: number; startsAt: number; endsAt: number };

export function ManagerRotaCalendar({ entityId, propertyId: controlledPropertyId, onPropertyChange }: { entityId: number; propertyId?: number; onPropertyChange?: (propertyId: number) => void }) {
  const isMobile = useIsMobile();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [localPropertyId, setLocalPropertyId] = useState("");
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [pendingMove, setPendingMove] = useState<MoveProposal | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [moveError, setMoveError] = useState("");
  const shifts = trpc.operations.shifts.useQuery({ entityId });
  const properties = trpc.entities.properties.useQuery({ entityId });
  const selectedProperty = controlledPropertyId ?? (localPropertyId ? Number(localPropertyId) : properties.data?.[0]?.id);
  const eligibleWorkers = trpc.operations.calendarWorkers.useQuery({ entityId, propertyId: selectedProperty! }, { enabled: Boolean(selectedProperty) });
  const utils = trpc.useUtils();
  const workers = useMemo(() => eligibleWorkers.data ?? [], [eligibleWorkers.data]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);
  const visibleShifts = (shifts.data ?? []).filter(item => item.status !== "cancelled" && item.propertyId === selectedProperty && item.startsAt < addDays(weekStart, 7).getTime() && item.endsAt >= weekStart.getTime());
  const mutation = trpc.operations.rescheduleShift.useMutation({
    onSuccess: async result => {
      await Promise.all([utils.operations.shifts.invalidate(), utils.operations.rotaOverview.invalidate(), utils.rotaControls.workspace.invalidate()]);
      setPendingMove(null); setOverrideReason(""); setMoveError("");
      toast.success(result.overridden ? "Shift rescheduled with manager override" : "Shift rescheduled", { description: result.warnings.length ? result.warnings.join(" · ") : "Worker and working-time checks passed." });
    },
    onError: error => { setMoveError(error.message); toast.error("Shift could not be moved", { description: error.message }); },
  });
  useEffect(() => { if (controlledPropertyId) setLocalPropertyId(String(controlledPropertyId)); }, [controlledPropertyId]);
  const selectProperty = (value: string) => { setLocalPropertyId(value); onPropertyChange?.(Number(value)); };
  const proposeMove = (shift: any, day: Date, assignedUserId?: number) => {
    if (!selectedProperty) return;
    const sourceStart = new Date(shift.startsAt);
    const targetStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sourceStart.getHours(), sourceStart.getMinutes());
    const proposal = { shift, propertyId: selectedProperty, assignedUserId, startsAt: targetStart.getTime(), endsAt: targetStart.getTime() + (shift.endsAt - shift.startsAt) };
    setPendingMove(proposal); setMoveError(""); setOverrideReason("");
  };
  const submitMove = (proposal: MoveProposal, reason?: string) => mutation.mutate({ entityId, shiftId: proposal.shift.id, propertyId: proposal.propertyId, assignedUserId: proposal.assignedUserId, startsAt: proposal.startsAt, endsAt: proposal.endsAt, expectedUpdatedAt: new Date(proposal.shift.updatedAt).getTime(), overrideReason: reason });
  const rows = [...workers.map(worker => ({ id: worker.userId, name: worker.name ?? `Key Worker ${worker.userId}` })), { id: undefined, name: "Open shifts" }];

  return <div className="space-y-4">
    <section className="surface flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
      <div><p className="eyebrow">RSM schedule</p><h2 className="mt-1 text-xl font-extrabold">Plan cover with confidence</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">Drag on desktop or use Move on mobile. Each save repeats property, dates, overlap, rest, availability and working-time checks on the server.</p></div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-end gap-2"><label className="grid min-w-0 gap-1 text-xs font-bold">Premise<Select value={String(selectedProperty ?? "")} onValueChange={selectProperty}><SelectTrigger className="h-10 min-w-40 rounded-xl bg-background text-left"><SelectValue placeholder="Choose property" /></SelectTrigger><SelectContent>{properties.data?.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></label><Button variant="outline" size="icon" className="h-10 w-10 rounded-xl bg-card" aria-label="Previous week" onClick={() => setWeekStart(addDays(weekStart, -7))}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" className="h-10 rounded-xl bg-card px-3" onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}>Today</Button><Button variant="outline" size="icon" className="h-10 w-10 rounded-xl bg-card" aria-label="Next week" onClick={() => setWeekStart(addDays(weekStart, 7))}><ChevronRight className="h-4 w-4" /></Button></div>
    </section>
    {!selectedProperty ? <p className="surface p-5 text-sm text-muted-foreground">Add or choose a property to start scheduling.</p> : isMobile ? <MobileScheduleBoard days={days} shifts={visibleShifts} onMove={shift => setPendingMove({ shift, propertyId: selectedProperty, assignedUserId: shift.assignedUserId ?? undefined, startsAt: shift.startsAt, endsAt: shift.endsAt })} /> : <DesktopScheduleBoard days={days} rows={rows} shifts={visibleShifts} onDragStart={setDraggedId} onDrop={(day, workerId) => { const shift = visibleShifts.find(item => item.id === draggedId); if (shift) proposeMove(shift, day, workerId); setDraggedId(null); }} onMove={shift => setPendingMove({ shift, propertyId: selectedProperty, assignedUserId: shift.assignedUserId ?? undefined, startsAt: shift.startsAt, endsAt: shift.endsAt })} />}
    <MoveDialog proposal={pendingMove} workers={workers} properties={properties.data ?? []} error={moveError} overrideReason={overrideReason} setOverrideReason={setOverrideReason} onClose={() => { setPendingMove(null); setMoveError(""); setOverrideReason(""); }} onChange={setPendingMove} onSubmit={() => pendingMove && submitMove(pendingMove, overrideReason || undefined)} pending={mutation.isPending} />
  </div>;
}

function coverageClass(shift: any) { return shift.coverageState === "uncovered" || shift.status === "open" ? "border-red-300 bg-red-50 text-red-950" : shift.coverageState === "at_risk" ? "border-amber-300 bg-amber-50 text-amber-950" : "border-sky-300 bg-sky-50 text-sky-950"; }

function DesktopScheduleBoard({ days, rows, shifts, onDragStart, onDrop, onMove }: { days: Date[]; rows: Array<{ id?: number; name: string }>; shifts: any[]; onDragStart: (id: number) => void; onDrop: (day: Date, workerId?: number) => void; onMove: (shift: any) => void }) {
  return <section className="surface overflow-x-auto" aria-label="Weekly Key Worker schedule"><div className="min-w-[1100px]"><div className="grid border-b border-border bg-muted/45" style={{ gridTemplateColumns: "180px repeat(7,minmax(130px,1fr))" }}><div className="p-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Key Worker</div>{days.map(day => <div key={day.toISOString()} className="border-l border-border p-3"><p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{format(day, "EEE")}</p><p className="mt-1 font-extrabold">{format(day, "d MMM")}</p></div>)}</div>{rows.map(worker => <div key={worker.id ?? "open"} className="grid border-b border-border last:border-0" style={{ gridTemplateColumns: "180px repeat(7,minmax(130px,1fr))" }}><div className="sticky left-0 z-10 bg-card p-3"><p className="text-sm font-extrabold">{worker.name}</p><p className="mt-1 text-xs text-muted-foreground">{worker.id ? "Assigned Key Worker" : "Unallocated coverage"}</p></div>{days.map(day => { const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(); const dayEnd = addDays(new Date(dayStart), 1).getTime(); const items = shifts.filter(shift => shift.assignedUserId === (worker.id ?? null) && shift.startsAt >= dayStart && shift.startsAt < dayEnd); return <div key={day.toISOString()} className="min-h-32 border-l border-border p-2 transition-colors hover:bg-sky-50/60" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }} onDrop={event => { event.preventDefault(); onDrop(day, worker.id); }}>{items.map(shift => <ShiftChip key={shift.id} shift={shift} onDragStart={() => onDragStart(shift.id)} onMove={() => onMove(shift)} />)}</div>; })}</div>)}</div></section>;
}

function MobileScheduleBoard({ days, shifts, onMove }: { days: Date[]; shifts: any[]; onMove: (shift: any) => void }) {
  return <section className="space-y-3" aria-label="Mobile weekly Key Worker schedule">{days.map(day => { const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime(); const end = addDays(new Date(start), 1).getTime(); const items = shifts.filter(shift => shift.startsAt >= start && shift.startsAt < end); return <article key={day.toISOString()} className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-border/70 px-4 py-3"><div><p className="eyebrow">{format(day, "EEEE")}</p><h3 className="mt-0.5 text-base font-extrabold">{format(day, "d MMMM")}</h3></div><Badge className="border-border bg-muted text-muted-foreground hover:bg-muted">{items.length} shift{items.length === 1 ? "" : "s"}</Badge></div><div className="divide-y divide-border/60">{items.length ? items.map(shift => <article key={shift.id} className="operational-row"><div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", shift.coverageState === "uncovered" || shift.status === "open" ? "bg-red-100 text-red-900" : shift.coverageState === "at_risk" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900")}><CalendarDays className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{shift.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{format(new Date(shift.startsAt), "HH:mm")}–{format(new Date(shift.endsAt), "HH:mm")} · {shift.assignedUserId ? shift.workerName ?? "Assigned Key Worker" : "Open cover"}</p></div><Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg bg-card" onClick={() => onMove(shift)}><Move className="mr-1.5 h-3.5 w-3.5" />Move</Button></article>) : <p className="p-4 text-sm text-muted-foreground">No shifts scheduled for this day.</p>}</div></article>; })}</section>;
}

function ShiftChip({ shift, onDragStart, onMove }: { shift: any; onDragStart: () => void; onMove: () => void }) { return <article draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(shift.id)); onDragStart(); }} className={cn("mb-2 cursor-grab rounded-xl border p-2 shadow-sm active:cursor-grabbing", coverageClass(shift))}><div className="flex items-start gap-2"><GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-extrabold">{shift.title}</p><p className="mt-1 text-[0.68rem]">{format(new Date(shift.startsAt), "HH:mm")}–{format(new Date(shift.endsAt), "HH:mm")}</p></div></div><button type="button" className="mt-2 flex min-h-8 w-full items-center justify-center rounded-lg border border-current/20 bg-card/70 text-xs font-bold" onClick={onMove}><Move className="mr-1 h-3 w-3" />Move</button></article>; }

function MoveDialog({ proposal, workers, properties, error, overrideReason, setOverrideReason, onClose, onChange, onSubmit, pending }: { proposal: MoveProposal | null; workers: any[]; properties: any[]; error: string; overrideReason: string; setOverrideReason: (value: string) => void; onClose: () => void; onChange: (value: MoveProposal | null) => void; onSubmit: () => void; pending: boolean }) {
  const update = (patch: Partial<MoveProposal>) => proposal && onChange({ ...proposal, ...patch });
  const startValue = proposal ? format(new Date(proposal.startsAt), "yyyy-MM-dd'T'HH:mm") : "";
  const endValue = proposal ? format(new Date(proposal.endsAt), "yyyy-MM-dd'T'HH:mm") : "";
  return <Dialog open={Boolean(proposal)} onOpenChange={open => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Move shift</DialogTitle><DialogDescription>Review the worker, property and times before saving. Server checks run again immediately before this change is accepted.</DialogDescription></DialogHeader>{proposal && <div className="grid gap-4"><label className="grid gap-2 text-sm font-bold">Property<Select value={String(proposal.propertyId)} onValueChange={value => update({ propertyId: Number(value) })}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{properties.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}</SelectContent></Select></label><label className="grid gap-2 text-sm font-bold">Key Worker<Select value={proposal.assignedUserId ? String(proposal.assignedUserId) : "open"} onValueChange={value => update({ assignedUserId: value === "open" ? undefined : Number(value) })}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="open">Open shift</SelectItem>{workers.map(item => <SelectItem key={item.userId} value={String(item.userId)}>{item.name}</SelectItem>)}</SelectContent></Select></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold">Starts<Input type="datetime-local" value={startValue} onChange={event => update({ startsAt: new Date(event.target.value).getTime() })} className="h-11 rounded-xl" /></label><label className="grid gap-2 text-sm font-bold">Ends<Input type="datetime-local" value={endValue} onChange={event => update({ endsAt: new Date(event.target.value).getTime() })} className="h-11 rounded-xl" /></label></div>{error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-950"><div className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>{error}</p></div></div>}{error.toLowerCase().includes("override") && <div className="grid gap-2"><Label>Manager override reason</Label><DictationTextarea value={overrideReason} onChange={event => setOverrideReason(event.target.value)} placeholder="Explain why the conflict is safe and authorised." /><p className="text-xs text-muted-foreground">Minimum 20 characters. The reason is encrypted and audited.</p></div>}</div>}<DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} disabled={!proposal || pending || (Boolean(error) && error.toLowerCase().includes("override") && overrideReason.trim().length < 20)}>{pending ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}Save move</Button></DialogFooter></DialogContent></Dialog>;
}
