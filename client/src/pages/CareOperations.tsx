import { EmptyState, PageHeader, StatusBadge } from "@/components/app/Primitives";
import { DictationTextarea } from "@/components/DictationFields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { YoungPersonExportDialog } from "@/components/PrintableRecordExports";
import { Activity, CalendarCheck, ChevronRight, HeartPulse, History, Mic, Pill, Plus, Printer, Search, ShieldCheck, Stethoscope, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type CareSection = "health" | "medication" | "curfew" | "activity";

export default function CareOperations() {
  const { entityId } = useWorkspace();
  const { user } = useAuth();
  const [propertyId, setPropertyId] = useState("");
  const [placementId, setPlacementId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const context = trpc.keywork.context.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId), retry: false });

  useEffect(() => {
    if (!propertyId && context.data?.properties.length === 1) setPropertyId(String(context.data.properties[0]!.id));
  }, [context.data?.properties, propertyId]);

  const placements = useMemo(() => context.data?.placements.filter(item => !propertyId || item.propertyId === Number(propertyId)) ?? [], [context.data, propertyId]);
  const care = trpc.care.workspace.useQuery({ entityId: entityId!, placementId: Number(placementId) }, { enabled: Boolean(entityId && placementId), retry: false });
  const templates = trpc.care.templates.useQuery({ entityId: entityId!, placementId: Number(placementId) }, { enabled: Boolean(entityId && placementId), retry: false });
  const history = trpc.care.history.useQuery({ entityId: entityId!, placementId: Number(placementId) }, { enabled: Boolean(entityId && placementId && historyOpen), retry: false });
  const canManagerAcknowledge = user?.operationalRole === "owner" || user?.operationalRole === "registered_manager";
  const selectedPlacement = placements.find(item => item.id === Number(placementId));
  const printPlacementRecord = () => {
    document.body.classList.add("care-print-mode");
    const clearPrintMode = () => document.body.classList.remove("care-print-mode");
    window.addEventListener("afterprint", clearPrintMode, { once: true });
    window.print();
    window.setTimeout(clearPrintMode, 200);
  };

  if (!entityId) return <EmptyState icon={HeartPulse} title="Choose an entity first" description="Care monitoring requires an accountable entity and assigned placement." />;
  if (context.isLoading) return <div className="surface h-64 animate-pulse" />;
  if (context.error) return <EmptyState icon={ShieldCheck} title="Care access restricted" description={context.error.message} />;

  return <div className="mx-auto max-w-6xl space-y-4 pb-24">
    <PageHeader eyebrow="Placement care" title="Health, medication and attendance" description="Only the young people linked to the property for your current shift appear here. Record factual observations, check dictated text and amend it before submitting." action={placementId ? <div className="no-print flex flex-wrap gap-2"><Button variant="outline" className="h-10 rounded-xl bg-card" onClick={() => setHistoryOpen(current => !current)}><History className="mr-2 h-4 w-4" />{historyOpen ? "Hide history" : "View history"}</Button><YoungPersonExportDialog entityId={entityId} placementId={Number(placementId)} reference={selectedPlacement?.reference ?? "Selected young person"} /><SetupDialog entityId={entityId} placementId={Number(placementId)} templates={templates.data ?? []} /><RecordDialog entityId={entityId} placementId={Number(placementId)} data={care.data} /><RecordDialog entityId={entityId} placementId={Number(placementId)} data={care.data} quickDictation /></div> : undefined} />
    <section className="surface grid gap-3 p-3 sm:grid-cols-2 sm:p-4">
      <Field label="Current-shift property">
        <Select value={propertyId} onValueChange={value => { setPropertyId(value); setPlacementId(""); }}>
          <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Choose an assigned property" /></SelectTrigger>
          <SelectContent>{context.data?.properties.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name} — {item.addressLine1}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label="Assigned young-person reference">
        <Select value={placementId} onValueChange={setPlacementId} disabled={!propertyId}>
          <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Choose an assigned reference" /></SelectTrigger>
          <SelectContent>{placements.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.reference}{item.preferredName ? ` — ${item.preferredName}` : ""}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
    </section>
    {!placementId ? <EmptyState icon={ShieldCheck} title="Choose an assigned placement" description="Care records remain restricted to people at the property assigned to your active shift." /> : care.isLoading ? <div className="surface h-64 animate-pulse" /> : care.error ? <EmptyState icon={ShieldCheck} title="Care access restricted" description={care.error.message} /> : <><CareGrid entityId={entityId} placementId={Number(placementId)} data={care.data} canManagerAcknowledge={canManagerAcknowledge} />{historyOpen && <PlacementHistory reference={selectedPlacement?.reference ?? "Selected young person"} preferredName={selectedPlacement?.preferredName ?? null} property={context.data?.properties.find(item => item.id === Number(propertyId))?.name ?? "Current-shift property"} query={historySearch} onQueryChange={setHistorySearch} onPrint={printPlacementRecord} isLoading={history.isLoading} error={history.error?.message} items={history.data?.items ?? []} />}</>}
  </div>;
}

function CareGrid({ entityId, placementId, data, canManagerAcknowledge }: { entityId: number; placementId: number; data: any; canManagerAcknowledge: boolean }) {
  return <div className="grid gap-3 xl:grid-cols-2">
    <CompactCareSection icon={CalendarCheck} title="College, court and appointments" subtitle={`${data.activities.length} scheduled activity records`}>
      {data.activities.slice(0, 8).map((item: any) => <CareRow key={item.id} title={`${item.activityType.replaceAll("_", " ")} · ${item.title}`} detail={`${new Date(item.scheduledStart).toLocaleString("en-GB")} · ${item.attendanceStatus.replaceAll("_", " ")}`} status={item.acknowledgedAt ? "acknowledged" : item.attendanceStatus} action={item.acknowledgementRequired && !item.acknowledgedAt ? <Ack entityId={entityId} placementId={placementId} type="activity" id={item.id} /> : undefined} />)}
    </CompactCareSection>
    <CompactCareSection icon={Activity} title="Curfew" subtitle={`${data.curfewPlans.length} plans · ${data.curfewChecks.length} checks`}>
      {data.curfewChecks.slice(0, 8).map((item: any) => <CareRow key={item.id} title={`Expected ${new Date(item.expectedAt).toLocaleString("en-GB")}`} detail={item.status.replaceAll("_", " ")} status={item.escalationRequired ? "escalation" : item.acknowledgedAt ? "acknowledged" : item.status} action={!item.acknowledgedAt ? <Ack entityId={entityId} placementId={placementId} type="curfew" id={item.id} /> : undefined} />)}
    </CompactCareSection>
    <CompactCareSection icon={UsersRound} title="Professional contacts" subtitle={`${data.contacts.length} contacts linked to this placement`}>
      {data.contacts.map((item: any) => <CareRow key={item.id} title={`${item.contactType.replaceAll("_", " ")} · ${item.name}`} detail={[item.organisation, item.phone, item.email].filter(Boolean).join(" · ")} status={item.status} />)}
    </CompactCareSection>
    <CompactCareSection icon={Pill} title="Medication" subtitle={`${data.medications.length} active records · ${data.administrations.length} administrations`}>
      {data.administrations.slice(0, 8).map((item: any) => <CareRow key={item.id} title={data.medications.find((med: any) => med.id === item.medicationId)?.name ?? "Medication"} detail={`${item.outcome.replaceAll("_", " ")} · ${new Date(item.scheduledAt).toLocaleString("en-GB")}`} status={item.escalationRequired ? "escalation" : item.managerAcknowledgedAt ? "acknowledged" : "review_due"} action={canManagerAcknowledge && !item.managerAcknowledgedAt ? <Ack entityId={entityId} placementId={placementId} type="medication" id={item.id} /> : undefined} />)}
    </CompactCareSection>
    <CompactCareSection icon={HeartPulse} title="Health monitoring" subtitle={`${data.healthPlans.length} plans · ${data.healthEvents.length} observations`}>
      {data.healthEvents.slice(0, 8).map((item: any) => <CareRow key={item.id} title={data.healthPlans.find((plan: any) => plan.id === item.planId)?.title ?? "Health observation"} detail={`${item.outcome.replaceAll("_", " ")}${item.value ? ` · ${item.value} ${item.unit ?? ""}` : ""}`} status={item.escalationRequired ? "escalation" : "recorded"} action={!item.acknowledgedAt ? <Ack entityId={entityId} placementId={placementId} type="health_event" id={item.id} /> : undefined} />)}
    </CompactCareSection>
  </div>;
}

function PlacementHistory({ reference, preferredName, property, query, onQueryChange, onPrint, isLoading, error, items }: { reference: string; preferredName: string | null; property: string; query: string; onQueryChange: (value: string) => void; onPrint: () => void; isLoading: boolean; error?: string; items: any[] }) {
  const normalisedQuery = query.trim().toLocaleLowerCase();
  const filteredItems = items.filter(item => !normalisedQuery || [item.category, item.title, item.detail, item.notes, item.status].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalisedQuery));
  return <section className="care-print-pack surface mt-4 overflow-hidden">
    <div className="border-b border-border/60 px-3 py-3 sm:px-4"><p className="eyebrow">Selected young-person record</p><div className="mt-1 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-extrabold">{reference}{preferredName ? ` — ${preferredName}` : ""}</h2><p className="text-xs text-muted-foreground">{property} · Care, attendance and Keyworker record history</p></div><div className="no-print flex flex-wrap gap-2"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={event => onQueryChange(event.target.value)} placeholder="Search this history" className="h-9 w-48 rounded-xl pl-9 text-sm" aria-label="Search selected young-person record history" /></div><Button variant="outline" className="h-9 rounded-xl bg-card" onClick={onPrint}><Printer className="mr-2 h-4 w-4" />Print record</Button></div></div></div>
    {isLoading ? <div className="h-48 animate-pulse bg-muted/50" /> : error ? <p role="alert" className="px-4 py-5 text-sm text-destructive">Unable to load this young person’s record history: {error}</p> : filteredItems.length ? <div className="divide-y divide-border/60">{filteredItems.map(item => <article key={item.id} className="care-history-row px-3 py-3 sm:px-4"><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-wide text-primary">{item.category}</p><h3 className="mt-1 text-sm font-extrabold">{item.title}</h3><p className="mt-0.5 text-xs text-muted-foreground">{new Date(item.occurredAt).toLocaleString("en-GB")} · {item.detail}</p>{item.notes ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground/90">{item.notes}</p> : null}</div><StatusBadge status={item.status} /></div></article>)}</div> : <p className="px-4 py-5 text-sm text-muted-foreground">{normalisedQuery ? "No records match this search." : "No previous care, attendance or Keyworker records are available for this young person."}</p>}
  </section>;
}

function CompactCareSection({ icon: Icon, title, subtitle, children }: { icon: typeof HeartPulse; title: string; subtitle: string; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  return <section className="surface overflow-hidden">
    <div className="flex min-h-16 items-center gap-3 border-b border-border/60 px-3 py-2.5 sm:px-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-extrabold">{title}</h2><p className="truncate text-xs text-muted-foreground">{subtitle}</p></div>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </div>
    <div className="divide-y divide-border/60">{Array.isArray(rows) && rows.length === 0 ? <p className="px-4 py-3 text-sm text-muted-foreground">No records yet. Use the compact action buttons above to add a controlled record.</p> : rows || <p className="px-4 py-3 text-sm text-muted-foreground">No records yet. Use the compact action buttons above to add a controlled record.</p>}</div>
  </section>;
}

function CareRow({ title, detail, status, action }: { title: string; detail: string; status: string; action?: React.ReactNode }) {
  return <article className="flex min-h-14 items-center gap-3 px-3 py-2.5 sm:px-4">
    <Stethoscope className="h-4 w-4 shrink-0 text-muted-foreground" />
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p></div>
    <div className="flex shrink-0 items-center gap-2"><StatusBadge status={status} />{action}</div>
  </article>;
}

function Ack({ entityId, placementId, type, id }: { entityId: number; placementId: number; type: "health_event" | "medication" | "curfew" | "activity"; id: number }) {
  const utils = trpc.useUtils();
  const mutation = trpc.care.acknowledge.useMutation({ onSuccess: () => { toast.success(type === "medication" ? "Manager acknowledgement recorded." : "Key Worker acknowledgement recorded."); utils.care.workspace.invalidate(); }, onError: error => toast.error(error.message) });
  return <Button size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => mutation.mutate({ entityId, placementId, recordType: type, recordId: id })} disabled={mutation.isPending}>Acknowledge</Button>;
}

function SetupDialog({ entityId, placementId, templates }: { entityId: number; placementId: number; templates: any[] }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("health");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [subtype, setSubtype] = useState("mental_wellbeing");
  const [templateId, setTemplateId] = useState("");
  const utils = trpc.useUtils();
  const health = trpc.care.createHealthPlan.useMutation();
  const medication = trpc.care.createMedication.useMutation();
  const curfew = trpc.care.createCurfewPlan.useMutation();
  const contact = trpc.care.addContact.useMutation();
  const busy = health.isPending || medication.isPending || curfew.isPending || contact.isPending;
  const save = async () => {
    try {
      if (type === "health") await health.mutateAsync({ entityId, placementId, templateId: templateId ? Number(templateId) : undefined, monitoringType: subtype as any, title: name, frequency: "event_based", instructions: detail || "Record the agreed observation and escalate outside the expected plan.", consentBasis: "care_plan", reviewDueAt: Date.now() + 90 * 86_400_000 });
      if (type === "medication") await medication.mutateAsync({ entityId, placementId, templateId: templateId ? Number(templateId) : undefined, name, form: "tablet", dose: detail || "As prescribed", route: "oral", frequency: "once_daily", administrationWindow: "As prescribed", instructions: "Follow the current medication record and escalation procedure." });
      if (type === "curfew") await curfew.mutateAsync({ entityId, placementId, templateId: templateId ? Number(templateId) : undefined, weekdays: [0, 1, 2, 3, 4, 5, 6], expectedReturnTime: detail || "22:00", instructions: "Confirm return, record contact attempts and follow the missing-from-home procedure when required." });
      if (type === "contact") await contact.mutateAsync({ entityId, placementId, contactType: subtype === "mental_wellbeing" ? "social_worker" : subtype as any, name, phone: detail || undefined, isPrimary: true });
      toast.success("Care setup saved."); setOpen(false); setName(""); setDetail(""); setTemplateId(""); utils.care.workspace.invalidate();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save care setup"); }
  };
  const detailLabel = type === "curfew" ? "Expected return (HH:MM)" : type === "contact" ? "Phone" : type === "medication" ? "Dose" : "Instructions";
  const routineTemplates = templates.filter(template => template.routineType === type);
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" className="h-10 rounded-xl bg-card"><Plus className="mr-2 h-4 w-4" />Add setup</Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Add placement care setup</DialogTitle><DialogDescription>Use a controlled plan before recording routine health, medication or curfew events. Check and amend all dictated text before saving.</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><Choice label="Setup type" value={type} onChange={value => { setType(value); setTemplateId(""); }} options={["health", "medication", "curfew", "contact"]} />{routineTemplates.length ? <Field label="Approved routine template"><Select value={templateId} onValueChange={value => { setTemplateId(value); const selected = routineTemplates.find(template => String(template.id) === value); if (selected) { setName(selected.title); setDetail(selected.bodyTemplate); } }}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Use a template (optional)" /></SelectTrigger><SelectContent>{routineTemplates.map(template => <SelectItem key={template.id} value={String(template.id)}>{template.title} · v{template.version}</SelectItem>)}</SelectContent></Select></Field> : null}{type === "health" && <Choice label="Monitoring type" value={subtype} onChange={setSubtype} options={["blood_pressure", "blood_glucose", "weight", "temperature", "seizure", "sleep", "nutrition", "hydration", "mental_wellbeing", "pain", "wound", "other"]} />}{type === "contact" && <Choice label="Contact type" value={subtype} onChange={setSubtype} options={["social_worker", "iro", "personal_adviser", "emergency_duty_team", "health", "education", "probation", "court", "family_advocate", "other"]} />}<Field label={type === "curfew" ? "Plan label" : type === "contact" ? "Contact name" : type === "medication" ? "Medication name" : "Plan title"}><Input value={name} onChange={event => setName(event.target.value)} className="h-11 rounded-xl" /></Field><Field label={detailLabel}>{type === "contact" ? <Input value={detail} onChange={event => setDetail(event.target.value)} className="h-11 rounded-xl" /> : <DictationTextarea value={detail} onChange={event => setDetail(event.target.value)} rows={4} className="min-h-28 rounded-xl" placeholder="Dictate or type, then review and amend before saving." />}</Field></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={!name || busy}>Save setup</Button></DialogFooter></DialogContent></Dialog>;
}

function RecordDialog({ entityId, placementId, data, quickDictation = false }: { entityId: number; placementId: number; data: any; quickDictation?: boolean }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<CareSection>("health");
  const [parent, setParent] = useState("");
  const [outcome, setOutcome] = useState("within_expected");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const utils = trpc.useUtils();
  const health = trpc.care.recordHealthEvent.useMutation();
  const medication = trpc.care.recordMedication.useMutation();
  const curfew = trpc.care.recordCurfew.useMutation();
  const activity = trpc.care.createActivity.useMutation();
  const parents = type === "health" ? data?.healthPlans ?? [] : type === "medication" ? data?.medications ?? [] : type === "curfew" ? data?.curfewPlans ?? [] : [];
  const activeParents = parents.filter((item: any) => item.status === "active");
  const busy = health.isPending || medication.isPending || curfew.isPending || activity.isPending;
  const save = async () => {
    try {
      if (type === "health") await health.mutateAsync({ entityId, placementId, planId: Number(parent), outcome: outcome as any, value: value || undefined, notes: notes || undefined, escalationRequired: outcome === "outside_expected" });
      if (type === "medication") await medication.mutateAsync({ entityId, placementId, medicationId: Number(parent), outcome: outcome as any, doseAcknowledged: value || undefined, reason: notes || undefined, escalationRequired: ["refused", "omitted", "unavailable"].includes(outcome) });
      if (type === "curfew") await curfew.mutateAsync({ entityId, placementId, curfewPlanId: Number(parent), expectedAt: Date.now(), actualAt: ["met", "late"].includes(outcome) ? Date.now() : undefined, status: outcome as any, contactAttempts: notes || undefined, escalationRequired: outcome === "absent" });
      if (type === "activity") await activity.mutateAsync({ entityId, placementId, activityType: outcome as any, title: value || "Scheduled activity", scheduledStart: Date.now(), attendanceStatus: "scheduled", transport: "staff", followUp: notes || undefined, acknowledgementRequired: true });
      toast.success("Care activity recorded."); setOpen(false); setValue(""); setNotes(""); utils.care.workspace.invalidate();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to record care activity"); }
  };
  const options = type === "health" ? ["within_expected", "outside_expected", "unable", "declined", "not_required", "other"] : type === "medication" ? ["taken", "refused", "omitted", "unavailable", "asleep", "away", "other"] : type === "curfew" ? ["met", "late", "absent", "authorised_away", "not_applicable", "pending"] : ["college", "education", "court", "probation", "health", "professional", "contact", "other"];
  const valueLabel = type === "activity" ? "Activity title or attendance detail" : type === "medication" ? "Dose acknowledged" : "Value or concise detail";
  return <Dialog open={open} onOpenChange={nextOpen => { if (!busy) { setOpen(nextOpen); if (nextOpen && quickDictation) { setType("health"); setParent(""); setOutcome("within_expected"); } } }}><DialogTrigger asChild>{quickDictation ? <Button variant="outline" className="h-10 rounded-xl bg-card"><Mic className="mr-2 h-4 w-4" />Add dictated record</Button> : <Button className="h-10 rounded-xl"><Plus className="mr-2 h-4 w-4" />Record activity</Button>}</DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Record care activity</DialogTitle><DialogDescription>Choose the record type and active plan. Dictated text is editable and must be checked for accuracy and spelling before it is recorded.</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><Choice label="Record type" value={type} onChange={value => { const next = value as CareSection; setType(next); setParent(""); setOutcome(next === "activity" ? "college" : next === "medication" ? "taken" : next === "curfew" ? "met" : "within_expected"); }} options={["health", "medication", "curfew", "activity"]} />{type !== "activity" && <Field label="Current plan">{activeParents.length ? <Select value={parent} onValueChange={setParent}><SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="Choose active plan" /></SelectTrigger><SelectContent>{activeParents.map((item: any) => <SelectItem key={item.id} value={String(item.id)}>{item.title ?? item.name ?? `Return ${item.expectedReturnTime}`}</SelectItem>)}</SelectContent></Select> : <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950">No active {type} plan is available. Select <strong>Add setup</strong> first, then return here to record the activity.</div>}</Field>}<Choice label={type === "activity" ? "Activity type" : "Outcome"} value={outcome} onChange={setOutcome} options={options} /><Field label={valueLabel}><DictationTextarea value={value} onChange={event => setValue(event.target.value)} rows={3} className="min-h-24 rounded-xl" placeholder="Dictate or type the factual detail, then review it." /></Field><Field label="Notes, contact attempts or follow-up"><DictationTextarea value={notes} onChange={event => setNotes(event.target.value)} rows={5} className="min-h-32 rounded-xl" placeholder="Include only factual observations, contact attempts, outcomes and follow-up required." /><p className="text-xs leading-5 text-muted-foreground">Review and amend the editable text, including spelling, before recording. The microphone processes speech in the browser; no audio file is stored.</p></Field></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button><Button onClick={() => void save()} disabled={busy || (type !== "activity" && (!parent || !activeParents.length)) || (type === "activity" && !value.trim())}>Record securely</Button></DialogFooter></DialogContent></Dialog>;
}

function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) {
  return <Field label={label}><Select value={value} onValueChange={onChange}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{options.map(option => <SelectItem key={option} value={option}>{option.replaceAll("_", " ")}</SelectItem>)}</SelectContent></Select></Field>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}
