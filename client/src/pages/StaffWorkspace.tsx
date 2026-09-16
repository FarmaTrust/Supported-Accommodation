import { EmptyState, PageHeader, StatusBadge } from "@/components/app/Primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { DictationTextarea } from "@/components/DictationFields";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { CalendarDays, ClipboardList, FileText, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import React, { useState } from "react";
import { toast } from "sonner";

const requestTypes = ["contact_change", "certificate_submission", "sickness", "holiday", "availability_change"] as const;
type RequestType = (typeof requestTypes)[number];

function asDate(value: number | Date | null | undefined) {
  return value ? new Date(value).toLocaleDateString("en-GB") : "Not set";
}

function readable(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

export const staffWorkspaceRestrictedMessage = "You do not have permission to open this staff workspace. Select a legal entity assigned to you or contact an authorised manager.";

export default function StaffWorkspacePage() {
  const { entityId } = useWorkspace();
  const context = trpc.staffWorkspace.context.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId), retry: false });
  const workspace = trpc.staffWorkspace.staffWorkspace.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId), retry: false });

  if (!entityId) return <EmptyState icon={UsersRound} title="Choose an entity first" description="Your staff workspace is available only within an organisation that has assigned you access." />;
  if (context.isLoading || workspace.isLoading) return <div className="mx-auto grid max-w-[1120px] gap-5" role="status" aria-label="Loading staff workspace"><Skeleton className="h-32 rounded-3xl" /><div className="grid gap-5 md:grid-cols-2"><Skeleton className="h-72 rounded-3xl" /><Skeleton className="h-72 rounded-3xl" /></div></div>;
  if (context.error || workspace.error) return <EmptyState icon={ShieldCheck} title="Staff workspace restricted" description={staffWorkspaceRestrictedMessage} />;

  const data = workspace.data!;
  if (!data.profile) return <div className="mx-auto max-w-[1120px]"><PageHeader eyebrow="Staff self-service" title="My staff workspace" description="Manage your own requests, supervision information and workforce profile without gaining access to other colleagues’ sensitive records." /><EmptyState icon={UserRound} title="No staff profile is linked" description="Ask an authorised manager to link your active workforce profile to this account. Your access remains limited until that link exists." /></div>;

  return <div className="mx-auto max-w-[1120px] space-y-4 pb-20"><PageHeader eyebrow="Staff self-service" title="My staff workspace" description="Manage your personal workforce requests and view supervision information. Requests are reviewed independently by an authorised manager." action={<StaffRequestDialog entityId={entityId} />} />
    <section className="surface operational-row rounded-xl"><div className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-accent-foreground"><UserRound className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-extrabold">{data.profile.fullName}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{data.profile.jobTitle} · {data.profile.employeeNumber ? `Employee no. ${data.profile.employeeNumber}` : readable(data.profile.employmentType)}</p></div><StatusBadge status={data.profile.status} /></section>
    <div className="grid gap-3 lg:grid-cols-2"><section className="surface overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-3"><div><p className="eyebrow">Requests</p><h2 className="text-base font-extrabold">My submitted requests</h2></div><ClipboardList className="h-4 w-4 text-primary" /></div>{data.requests.length ? <div className="divide-y divide-border/60">{data.requests.map(request => <article key={request.id} className="operational-row"><div className="min-w-0 flex-1"><p className="text-sm font-bold">{readable(request.requestType)}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">Submitted {asDate(request.createdAt)}{request.startsAt ? ` · ${asDate(request.startsAt)}${request.endsAt ? ` to ${asDate(request.endsAt)}` : ""}` : ""}</p></div><StatusBadge status={request.status} /></article>)}</div> : <p className="p-4 text-sm text-muted-foreground">No requests are recorded. Use <strong className="font-semibold text-foreground">New request</strong> to submit a personal change, absence or availability request.</p>}</section>
      <section className="surface overflow-hidden"><div className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-3"><div><p className="eyebrow">Supervision</p><h2 className="text-base font-extrabold">My sessions</h2></div><CalendarDays className="h-4 w-4 text-primary" /></div>{data.supervisions.length ? <div className="divide-y divide-border/60">{data.supervisions.map(session => <article key={session.id} className="operational-row"><div className="min-w-0 flex-1"><p className="text-sm font-bold">Scheduled {asDate(session.scheduledAt)}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{session.location || "Location to be confirmed"}{session.sharedNotes ? ` · ${session.sharedNotes}` : ""}</p></div><StatusBadge status={session.status} /></article>)}</div> : <p className="p-4 text-sm text-muted-foreground">No supervision sessions are currently shared with you.</p>}</section></div>
    <section className="rounded-3xl border border-primary/15 bg-primary/5 p-5"><div className="flex gap-3"><FileText className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><p className="text-sm leading-6 text-muted-foreground">This workspace exposes only your own staff profile, requests and shared supervision notes. It does not provide access to another colleague’s HR, recruitment or manager-only records.</p></div></section>
  </div>;
}

function StaffRequestDialog({ entityId }: { entityId: number }) {
  const [open, setOpen] = useState(false);
  const [requestType, setRequestType] = useState<RequestType>("holiday");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [details, setDetails] = useState("");
  const utils = trpc.useUtils();
  const submit = trpc.staffWorkspace.submitStaffRequest.useMutation({ onSuccess: async () => { await utils.staffWorkspace.staffWorkspace.invalidate({ entityId }); setOpen(false); setStartsAt(""); setEndsAt(""); setDetails(""); toast.success("Request submitted", { description: "An authorised manager can now review it independently." }); }, onError: error => toast.error("Could not submit request", { description: error.message }) });
  const dateToMs = (value: string) => new Date(`${value}T12:00:00Z`).getTime();
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="rounded-xl">New request</Button></DialogTrigger><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Submit a staff request</DialogTitle><DialogDescription>Submit only your own absence, availability, contact or evidence request. The detailed note is restricted to the review workflow.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div className="grid gap-2"><Label>Request type</Label><Select value={requestType} onValueChange={value => setRequestType(value as RequestType)}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{requestTypes.map(type => <SelectItem key={type} value={type}>{readable(type)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label htmlFor="staff-request-start">Start date</Label><Input id="staff-request-start" type="date" value={startsAt} onChange={event => setStartsAt(event.target.value)} /></div><div className="grid gap-2"><Label htmlFor="staff-request-end">End date</Label><Input id="staff-request-end" type="date" value={endsAt} onChange={event => setEndsAt(event.target.value)} /></div></div><div className="grid gap-2"><Label htmlFor="staff-request-details">Request details</Label><DictationTextarea id="staff-request-details" rows={6} value={details} onChange={event => setDetails(event.target.value)} placeholder="State only the information needed for the request and review." /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={details.trim().length < 3 || submit.isPending} onClick={() => submit.mutate({ entityId, requestType, details: details.trim(), startsAt: startsAt ? dateToMs(startsAt) : undefined, endsAt: endsAt ? dateToMs(endsAt) : undefined })}>{submit.isPending ? "Submitting…" : "Submit request"}</Button></DialogFooter></DialogContent></Dialog>;
}
