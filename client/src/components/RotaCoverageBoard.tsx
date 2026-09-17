import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleAlert, Clock3, MapPin, ShieldCheck, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

type OverviewShift = {
  id: number;
  propertyId: number;
  propertyName: string;
  assignedUserId: number | null;
  workerName: string | null;
  title: string;
  startsAt: number;
  endsAt: number;
  status: string;
  coverageState: string;
  requiredRole?: string | null;
};

type RotaOverview = {
  rotaDayStart: number;
  rotaDayEnd: number;
  shifts: OverviewShift[];
  properties: Array<{ id: number; name: string; minimumStaffing: number }>;
  colleagues: Array<{ id: number; name: string }>;
  coverage: { total: number; covered: number; atRisk: number; uncovered: number; missingMinutes: number };
  coverageGaps: Array<{ key: string; propertyId: number; propertyName: string; startsAt: number; endsAt: number; requiredStaffing: number; allocatedStaffing: number; deficit: number; relatedShiftIds: number[] }>;
  propertySummary: Array<{ id: number; name: string; total: number; covered: number; atRisk: number; uncovered: number; missingMinutes: number }>;
  groups: Array<{ kind: "working_together" | "close_overlap"; propertyId: number; propertyName: string; startsAt: number; endsAt: number; workerNames: string[]; shiftIds: number[] }>;
  integrity: { state: "checked" | "needs_review"; invalidWindowShiftIds: number[]; overlappingShiftIds: number[] };
};

export type RotaCoverageFilter = "all" | "uncovered" | "at_risk" | "covered";
export type RotaManagerPerspective = "premises" | "workers";

const DAY_MARKS = ["06:00", "12:00", "18:00", "00:00", "06:00"];
const DAY_MS = 24 * 60 * 60 * 1_000;

function shiftTone(shift: OverviewShift) {
  if (shift.coverageState === "uncovered" || shift.status === "open" || shift.assignedUserId === null) return "border-red-300 bg-red-50 text-red-950";
  if (shift.coverageState === "at_risk") return "border-amber-300 bg-amber-50 text-amber-950";
  const colours = ["border-sky-300 bg-sky-50 text-sky-950", "border-violet-300 bg-violet-50 text-violet-950", "border-teal-300 bg-teal-50 text-teal-950", "border-indigo-300 bg-indigo-50 text-indigo-950"];
  const seed = (shift.assignedUserId ?? shift.id) % colours.length;
  return colours[seed] ?? colours[0]!;
}

function formatTime(value: number) {
  return new Date(value).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatShortDate(value: number) {
  return new Date(value).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function position(shift: OverviewShift, start: number) {
  const clampedStart = Math.max(shift.startsAt, start);
  const clampedEnd = Math.min(shift.endsAt, start + DAY_MS);
  return { left: `${Math.max(0, ((clampedStart - start) / DAY_MS) * 100)}%`, width: `${Math.max(4, ((clampedEnd - clampedStart) / DAY_MS) * 100)}%` };
}

export function RotaDayLabel({ rotaDayStart }: { rotaDayStart: number }) {
  return <p className="text-xs font-semibold text-muted-foreground"><span className="font-bold text-foreground">{formatShortDate(rotaDayStart)}</span> · Operational day <span className="tabular-nums">06:00 → 06:00</span></p>;
}

export function RotaCoverageBoard({ overview, colleagueId, coverageFilter, onCoverageFilter, onSchedule, onFindReplacement, managerPerspective = "premises" }: { overview: RotaOverview; colleagueId?: number; coverageFilter: RotaCoverageFilter; onCoverageFilter: (value: RotaCoverageFilter) => void; onSchedule?: () => void; onFindReplacement?: (gap: RotaOverview["coverageGaps"][number]) => void; managerPerspective?: RotaManagerPerspective }) {
  const visibleShifts = useMemo(() => overview.shifts.filter(shift => {
    const matchesColleague = !colleagueId || shift.assignedUserId === colleagueId;
    const matchesCoverage = coverageFilter === "all" || shift.coverageState === coverageFilter || (coverageFilter === "uncovered" && (shift.status === "open" || shift.assignedUserId === null));
    return matchesColleague && matchesCoverage;
  }), [colleagueId, coverageFilter, overview.shifts]);
  const uncoveredShifts = visibleShifts.filter(shift => shift.coverageState === "uncovered" || shift.status === "open" || shift.assignedUserId === null);
  const coverageGaps = !colleagueId && (coverageFilter === "all" || coverageFilter === "uncovered") ? overview.coverageGaps : [];
  const nowPercent = ((Date.now() - overview.rotaDayStart) / DAY_MS) * 100;
  const isCurrentWindow = nowPercent >= 0 && nowPercent <= 100;
  const metrics = [
    { value: "all" as const, label: "Scheduled", count: overview.coverage.total, icon: Clock3, tone: "bg-sky-100 text-sky-950" },
    { value: "covered" as const, label: "Covered", count: overview.coverage.covered, icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-950" },
    { value: "at_risk" as const, label: "Needs review", count: overview.coverage.atRisk, icon: AlertTriangle, tone: "bg-amber-100 text-amber-950" },
    { value: "uncovered" as const, label: "Coverage gaps", count: overview.coverage.uncovered, icon: CircleAlert, tone: "bg-red-100 text-red-950" },
  ];
  return <div className="space-y-4">
    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Selected rota coverage">
      {metrics.map(metric => <button key={metric.value} type="button" onClick={() => onCoverageFilter(metric.value)} aria-pressed={coverageFilter === metric.value} className={cn("group surface flex min-h-[5.25rem] items-center gap-3 border p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", coverageFilter === metric.value ? "border-primary ring-1 ring-primary/20" : "border-transparent")}>
        <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", metric.tone)}><metric.icon className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1"><p className="text-sm font-extrabold">{metric.label}</p><p className="mt-0.5 text-xs text-muted-foreground">Selected operational day</p></div>
        <span className="text-2xl font-extrabold tracking-[-0.05em] tabular-nums">{metric.count}</span>
      </button>)}
    </section>

    <section className={cn("rounded-2xl border p-3 sm:p-4", overview.integrity.state === "checked" ? "border-emerald-200 bg-emerald-50/70 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950")}>
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0"><p className="text-sm font-extrabold">{overview.integrity.state === "checked" ? "Data checked" : "Data needs review"}</p><p className="mt-0.5 text-xs leading-5">{overview.integrity.state === "checked" ? "The selected rota has no overlapping worker assignments or invalid time windows. This status supports, but never replaces, management and safeguarding review." : `${overview.integrity.invalidWindowShiftIds.length + overview.integrity.overlappingShiftIds.length} timing or allocation issue(s) need a manager decision before scheduling changes.`}</p></div></div>
    </section>

    {coverageGaps.length ? <section className="overflow-hidden rounded-2xl border border-red-200 bg-red-50/70"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 px-4 py-3"><div><p className="eyebrow text-red-800">Priority action</p><h2 className="mt-0.5 text-base font-extrabold text-red-950">Coverage gap{coverageGaps.length === 1 ? "" : "s"}</h2><p className="mt-1 text-xs text-red-900">{formatMissingMinutes(overview.coverage.missingMinutes)} of required cover is missing across the selected 06:00–06:00 day.</p></div>{onSchedule ? <Button size="sm" className="h-9 rounded-lg bg-red-700 text-white hover:bg-red-800" onClick={onSchedule}>Open schedule <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button> : null}</div><div className="divide-y divide-red-200/80">{coverageGaps.slice(0, 4).map(gap => <div key={gap.key} className="flex flex-wrap items-center gap-3 px-4 py-3"><CircleAlert className="h-4 w-4 shrink-0 text-red-700" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-red-950">{gap.propertyName}</p><p className="mt-0.5 text-xs text-red-900">{formatTime(gap.startsAt)}–{formatTime(gap.endsAt)} · {gap.deficit} of {gap.requiredStaffing} required Key Worker{gap.requiredStaffing === 1 ? "" : "s"} missing</p></div><div className="flex items-center gap-2"><Badge variant="destructive">Urgent</Badge>{onFindReplacement ? <Button size="sm" className="h-8 rounded-lg bg-red-700 text-xs text-white hover:bg-red-800" onClick={() => onFindReplacement(gap)}>Find replacement</Button> : null}</div></div>)}</div></section> : uncoveredShifts.length ? <section className="overflow-hidden rounded-2xl border border-red-200 bg-red-50/70"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-200 px-4 py-3"><div><p className="eyebrow text-red-800">Priority action</p><h2 className="mt-0.5 text-base font-extrabold text-red-950">Open shift{uncoveredShifts.length === 1 ? "" : "s"}</h2></div>{onSchedule ? <Button size="sm" className="h-9 rounded-lg bg-red-700 text-white hover:bg-red-800" onClick={onSchedule}>Assign cover <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></Button> : null}</div><div className="divide-y divide-red-200/80">{uncoveredShifts.slice(0, 4).map(shift => <div key={shift.id} className="flex items-center gap-3 px-4 py-3"><CircleAlert className="h-4 w-4 shrink-0 text-red-700" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold text-red-950">{shift.title} · {shift.propertyName}</p><p className="mt-0.5 text-xs text-red-900">{formatTime(shift.startsAt)}–{formatTime(shift.endsAt)} · {shift.requiredRole ? `Required: ${shift.requiredRole}` : "No worker allocated"}</p></div><Badge variant="destructive">Open</Badge></div>)}</div></section> : null}

    <section className="surface overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3"><div><p className="eyebrow">Selected-day coverage</p><h2 className="mt-0.5 text-lg font-extrabold">{managerPerspective === "premises" ? "Premise coverage lanes" : "Shift Worker lanes"}</h2><p className="mt-1 text-xs text-muted-foreground">Compact 06:00–06:00 timeline. Each labelled block shows the allocated worker and full shift times remain available.</p></div><RotaDayLabel rotaDayStart={overview.rotaDayStart} /></div><CompactTimeline overview={overview} shifts={visibleShifts} perspective={managerPerspective} livePercent={isCurrentWindow ? nowPercent : null} /></section>
  </div>;
}

function TimelineRow({ shift, rotaDayStart, livePercent }: { shift: OverviewShift; rotaDayStart: number; livePercent: number | null }) {
  const style = position(shift, rotaDayStart);
  const label = `${shift.title}, ${shift.propertyName}, ${formatTime(shift.startsAt)} to ${formatTime(shift.endsAt)}, ${shift.assignedUserId ? shift.workerName ?? "Allocated worker" : "open shift"}`;
  return <article className="grid grid-cols-[8.5rem_minmax(0,1fr)] items-center gap-2"><div className="min-w-0"><p className="truncate text-xs font-extrabold">{shift.assignedUserId ? shift.workerName ?? "Allocated worker" : "Open cover"}</p><p className="truncate text-[0.68rem] text-muted-foreground">{formatTime(shift.startsAt)}–{formatTime(shift.endsAt)}</p><p className="truncate text-[0.68rem] text-muted-foreground">{shift.propertyName}</p></div><div className="relative h-11 overflow-hidden rounded-xl bg-muted/70" aria-label={label}>{livePercent !== null ? <span className="absolute inset-y-0 z-10 border-l-2 border-primary" style={{ left: `${livePercent}%` }}><span className="absolute -top-0.5 left-1 rounded bg-primary px-1 py-0.5 text-[0.58rem] font-bold text-primary-foreground">Live now</span></span> : null}<div className={cn("absolute inset-y-1.5 flex min-w-12 items-center truncate rounded-lg border px-2 text-[0.65rem] font-extrabold shadow-sm", shiftTone(shift))} style={style} title={label}><span className="truncate">{shift.title}</span></div></div></article>;
}

function CompactTimeline({ overview, shifts, perspective, livePercent }: { overview: RotaOverview; shifts: OverviewShift[]; perspective: RotaManagerPerspective; livePercent: number | null }) {
  const lanes = useMemo(() => {
    const map = new Map<string, { key: string; title: string; detail: string; shifts: OverviewShift[] }>();
    for (const shift of shifts) {
      const key = perspective === "premises" ? `premise-${shift.propertyId}` : `worker-${shift.assignedUserId ?? "open"}`;
      const title = perspective === "premises" ? shift.propertyName : shift.assignedUserId ? shift.workerName ?? "Allocated worker" : "Open cover";
      const detail = perspective === "premises" ? `${shifts.filter(item => item.propertyId === shift.propertyId).length} scheduled block(s)` : shift.assignedUserId ? "Assigned shift worker" : "Unallocated requirement";
      const lane = map.get(key) ?? { key, title, detail, shifts: [] };
      lane.shifts.push(shift);
      map.set(key, lane);
    }
    return Array.from(map.values()).sort((left, right) => left.title.localeCompare(right.title));
  }, [perspective, shifts]);
  return <div className="p-3 sm:p-4"><div className="relative ml-24 h-5 border-b border-border/80 sm:ml-32">{DAY_MARKS.map((mark, index) => <span key={`${mark}-${index}`} className="absolute -bottom-4 text-[0.6rem] font-bold text-muted-foreground" style={{ left: `${(index / (DAY_MARKS.length - 1)) * 100}%`, transform: index === DAY_MARKS.length - 1 ? "translateX(-100%)" : index === 0 ? "none" : "translateX(-50%)" }}>{mark}</span>)}</div><div className="mt-7 space-y-2">{lanes.length ? lanes.map(lane => <CompactTimelineLane key={lane.key} lane={lane} rotaDayStart={overview.rotaDayStart} livePercent={livePercent} perspective={perspective} />) : <div className="grid min-h-28 place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">No shifts match the selected filter.</div>}</div></div>;
}

function CompactTimelineLane({ lane, rotaDayStart, livePercent, perspective }: { lane: { key: string; title: string; detail: string; shifts: OverviewShift[] }; rotaDayStart: number; livePercent: number | null; perspective: RotaManagerPerspective }) {
  const rowHeight = Math.max(44, lane.shifts.length * 28 + 8);
  return <article className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]"><div className="min-w-0 py-1"><p className="truncate text-xs font-extrabold">{lane.title}</p><p className="mt-0.5 truncate text-[0.62rem] leading-4 text-muted-foreground">{lane.detail}</p></div><div className="relative overflow-hidden rounded-xl bg-muted/70" style={{ height: rowHeight }} aria-label={`${lane.title} timeline`}>{livePercent !== null ? <span className="absolute inset-y-0 z-20 border-l-2 border-primary" style={{ left: `${livePercent}%` }} /> : null}{lane.shifts.map((shift, index) => {
    const label = perspective === "premises" ? `${shift.assignedUserId ? shift.workerName ?? "Allocated worker" : "Open cover"} · ${formatTime(shift.startsAt)}–${formatTime(shift.endsAt)}` : `${shift.propertyName} · ${formatTime(shift.startsAt)}–${formatTime(shift.endsAt)}`;
    return <div key={shift.id} className={cn("absolute flex min-w-10 items-center truncate rounded-md border px-1.5 text-[0.58rem] font-extrabold shadow-sm", shiftTone(shift))} style={{ ...position(shift, rotaDayStart), top: 4 + index * 28, height: 23 }} title={`${shift.title} · ${label}`}><span className="truncate">{label}</span></div>;
  })}</div></article>;
}

export function RotaColleagueGroups({ overview, colleagueId }: { overview: RotaOverview; colleagueId?: number }) {
  const [groupType, setGroupType] = useState<"all" | "working_together" | "close_overlap">("all");
  const groups = overview.groups.filter(group => (groupType === "all" || group.kind === groupType) && (!colleagueId || group.shiftIds.some(shiftId => overview.shifts.find(shift => shift.id === shiftId)?.assignedUserId === colleagueId)));
  return <div className="space-y-4"><section className="surface overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3"><div><p className="eyebrow">Colleague coordination</p><h2 className="mt-0.5 text-lg font-extrabold">Who is working together</h2><p className="mt-1 text-xs text-muted-foreground">Groups are calculated from the same selected-day shift records as coverage.</p></div><div className="flex rounded-xl bg-muted p-1" aria-label="Colleague group filter">{[{ value: "all", label: "All" }, { value: "working_together", label: "Working together" }, { value: "close_overlap", label: "Handover overlap" }].map(option => <button key={option.value} type="button" onClick={() => setGroupType(option.value as typeof groupType)} className={cn("min-h-8 rounded-lg px-2.5 text-xs font-bold", groupType === option.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{option.label}</button>)}</div></div><div className="divide-y divide-border/60">{groups.length ? groups.map((group, index) => <article key={`${group.kind}-${group.shiftIds.join("-")}-${index}`} className="operational-row"><div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", group.kind === "working_together" ? "bg-violet-100 text-violet-900" : "bg-amber-100 text-amber-900")}><UsersRound className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{group.kind === "working_together" ? "Working together" : "Close overlap / handover"}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{group.propertyName} · {formatTime(group.startsAt)}–{formatTime(group.endsAt)}</p><div className="mt-2 flex flex-wrap gap-1.5">{group.workerNames.map(worker => <span key={worker} className="rounded-md bg-secondary px-2 py-1 text-[0.68rem] font-bold text-secondary-foreground">{worker}</span>)}</div></div></article>) : <div className="grid min-h-36 place-items-center px-5 text-center"><div><UsersRound className="mx-auto h-5 w-5 text-muted-foreground" /><p className="mt-2 text-sm font-bold">No matching colleague groups</p><p className="mt-1 text-xs text-muted-foreground">Groups appear when two colleagues share an exact shift, or have a handover overlap of two hours or less.</p></div></div>}</div></section><section className="surface overflow-hidden"><div className="border-b border-border/70 px-4 py-3"><p className="eyebrow">Premise summary</p><h2 className="mt-0.5 text-lg font-extrabold">Coverage by property</h2></div><div className="divide-y divide-border/60">{overview.propertySummary.map(property => <article key={property.id} className="operational-row"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-900"><MapPin className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{property.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{property.total} shift{property.total === 1 ? "" : "s"} · {property.covered} covered · {property.atRisk} needs review{property.uncovered ? ` · ${formatMissingMinutes(property.missingMinutes)} missing` : ""}</p></div>{property.uncovered ? <Badge variant="destructive">{property.uncovered} gap{property.uncovered === 1 ? "" : "s"}</Badge> : <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">Covered</Badge>}</article>)}</div></section></div>;
}

function formatMissingMinutes(value: number) {
  if (value < 60) return `${value} min`;
  return `${Math.floor(value / 60)}h ${value % 60 ? `${value % 60}m` : ""}`.trim();
}

export function KeyworkerRotaSummary({ shifts, propertyNames }: { shifts: Array<{ id: number; title: string; propertyId: number; startsAt: number; endsAt: number; coverageState: string }>; propertyNames: Map<number, string> }) {
  const now = Date.now();
  const relevant = shifts.filter(shift => shift.endsAt >= now).slice(0, 4);
  return <section className="surface overflow-hidden"><div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5"><div><p className="eyebrow">My rota</p><h2 className="mt-1 text-lg font-extrabold">My current and next shifts</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Only your assigned shifts are shown. Your RSM manages coverage and scheduling.</p></div><Badge className="border-sky-200 bg-sky-50 text-sky-900 hover:bg-sky-50">Personal view</Badge></div><div className="divide-y divide-border/60">{relevant.length ? relevant.map(shift => <article key={shift.id} className="operational-row"><div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", shift.startsAt <= now && shift.endsAt >= now ? "bg-emerald-100 text-emerald-900" : "bg-secondary text-secondary-foreground")}><CalendarIcon className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{shift.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{propertyNames.get(shift.propertyId) ?? "Assigned property"} · {formatShortDate(shift.startsAt)} · {formatTime(shift.startsAt)}–{formatTime(shift.endsAt)}</p></div><Badge className={cn("capitalize", shift.startsAt <= now && shift.endsAt >= now ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50" : "border-border bg-muted text-muted-foreground hover:bg-muted")}>{shift.startsAt <= now && shift.endsAt >= now ? "On shift" : "Scheduled"}</Badge></article>) : <div className="p-4 text-sm text-muted-foreground">No current or upcoming assigned shifts are available. Contact your RSM if you expected a shift.</div>}</div></section>;
}

function CalendarIcon({ className }: { className?: string }) {
  return <Clock3 className={className} />;
}
