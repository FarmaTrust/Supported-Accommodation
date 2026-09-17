import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DictationTextarea } from "@/components/DictationFields";
import { trpc } from "@/lib/trpc";
import { LogIn, LogOut, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

type PropertyOption = { id: number; name: string; addressLine1?: string | null };
type VisitorType = "friend" | "relative" | "professional" | "contractor" | "public_official" | "other";
type IdCheckStatus = "not_required" | "not_checked" | "verified" | "declined" | "unavailable";

type DepartureTarget = { id: number; version: number; name: string | null };

const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
const localTime = (value: number) => new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function VisitorLogDialog({ entityId, properties, open, onOpenChange, initialPropertyId }: { entityId: number; properties: PropertyOption[]; open: boolean; onOpenChange: (open: boolean) => void; initialPropertyId?: number }) {
  const [propertyId, setPropertyId] = useState("");
  const [visitorType, setVisitorType] = useState<VisitorType>("professional");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [purpose, setPurpose] = useState("");
  const [idCheckStatus, setIdCheckStatus] = useState<IdCheckStatus>("not_checked");
  const [notes, setNotes] = useState("");
  const [departureTarget, setDepartureTarget] = useState<DepartureTarget | null>(null);
  const [departureNotes, setDepartureNotes] = useState("");
  const utils = trpc.useUtils();
  const selectedPropertyId = Number(propertyId);
  const workspace = trpc.staffWorkspace.propertyWorkspace.useQuery({ entityId, propertyId: selectedPropertyId }, { enabled: open && Boolean(selectedPropertyId), retry: false });

  const arrive = trpc.staffWorkspace.arriveVisitor.useMutation({
    onSuccess: async () => {
      await utils.staffWorkspace.propertyWorkspace.invalidate({ entityId, propertyId: selectedPropertyId });
      setName(""); setRelationship(""); setPurpose(""); setNotes(""); setIdCheckStatus("not_checked");
      toast.success("Visitor logged", { description: "The property visitor record and arrival audit event were created." });
    },
    onError: error => toast.error("Visitor could not be logged", { description: error.message }),
  });
  const depart = trpc.staffWorkspace.departVisitor.useMutation({
    onSuccess: async () => {
      await utils.staffWorkspace.propertyWorkspace.invalidate({ entityId, propertyId: selectedPropertyId });
      setDepartureTarget(null); setDepartureNotes("");
      toast.success("Visitor checked out", { description: "The departure time and any departure note are now recorded in the property log." });
    },
    onError: error => toast.error("Visitor could not be checked out", { description: error.message }),
  });

  useEffect(() => {
    if (!open) return;
    const next = initialPropertyId ?? properties[0]?.id;
    if (next) setPropertyId(String(next));
  }, [initialPropertyId, open, properties]);

  const submit = () => {
    if (!selectedPropertyId || name.trim().length < 2 || purpose.trim().length < 2) return;
    arrive.mutate({ entityId, propertyId: selectedPropertyId, visitorType, name: name.trim(), relationship: relationship.trim() || undefined, purpose: purpose.trim(), idCheckStatus, notes: notes.trim() || undefined });
  };
  const confirmDeparture = () => {
    if (!departureTarget) return;
    depart.mutate({ entityId, visitorId: departureTarget.id, expectedVersion: departureTarget.version, departureNotes: departureNotes.trim() || undefined });
  };
  const activeVisitors = (workspace.data?.visitors ?? []).filter(visitor => visitor.status === "on_site" || visitor.status === "overdue");
  const departedVisitors = (workspace.data?.visitors ?? []).filter(visitor => visitor.status === "departed").slice(0, 5);

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Visitor log</DialogTitle><DialogDescription>Record arrivals and departures at an authorised property. Visitor names and notes are encrypted; do not record more personal information than required.</DialogDescription></DialogHeader><div className="grid gap-3 py-1"><div className="grid gap-1.5"><Label>Property</Label><Select value={propertyId} onValueChange={setPropertyId}><SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose an authorised property" /></SelectTrigger><SelectContent>{properties.map(property => <SelectItem key={property.id} value={String(property.id)}>{property.name}{property.addressLine1 ? ` · ${property.addressLine1}` : ""}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="grid gap-1.5"><Label>Visitor type</Label><Select value={visitorType} onValueChange={value => setVisitorType(value as VisitorType)}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{(["friend", "relative", "professional", "contractor", "public_official", "other"] as const).map(value => <SelectItem key={value} value={value}>{readable(value)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1.5"><Label>ID check</Label><Select value={idCheckStatus} onValueChange={value => setIdCheckStatus(value as IdCheckStatus)}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{(["not_required", "not_checked", "verified", "declined", "unavailable"] as const).map(value => <SelectItem key={value} value={value}>{readable(value)}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-1.5"><Label htmlFor="visitor-name">Name</Label><Input id="visitor-name" value={name} onChange={event => setName(event.target.value)} className="h-10 rounded-xl" placeholder="Visitor's name" /></div><div className="grid gap-1.5"><Label htmlFor="visitor-relationship">Relationship or organisation</Label><Input id="visitor-relationship" value={relationship} onChange={event => setRelationship(event.target.value)} className="h-10 rounded-xl" placeholder="Optional" /></div><div className="grid gap-1.5"><Label htmlFor="visitor-purpose">Purpose of visit</Label><Input id="visitor-purpose" value={purpose} onChange={event => setPurpose(event.target.value)} className="h-10 rounded-xl" placeholder="For example: planned professional meeting" /></div><div className="grid gap-1.5"><Label htmlFor="visitor-notes">Notes</Label><DictationTextarea id="visitor-notes" value={notes} onChange={event => setNotes(event.target.value)} className="min-h-20 rounded-xl" placeholder="Optional factual notes only" /></div></div><DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={arrive.isPending}>Close</Button><Button onClick={submit} disabled={arrive.isPending || !selectedPropertyId || name.trim().length < 2 || purpose.trim().length < 2}><LogIn className="mr-2 h-4 w-4" />{arrive.isPending ? "Logging…" : "Log arrival"}</Button></DialogFooter>{selectedPropertyId && <section className="mt-2 border-t border-border/70 pt-4"><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-primary" /><div><p className="text-sm font-extrabold">Visitors currently on site</p><p className="text-xs text-muted-foreground">Checkout records the departure time and an optional factual departure note.</p></div></div>{workspace.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading visitor log…</p> : activeVisitors.length ? <div className="mt-3 space-y-2">{activeVisitors.map(visitor => <article key={visitor.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-bold">{visitor.name || "Protected visitor"}</p><p className="truncate text-xs text-muted-foreground">{readable(visitor.visitorType)} · arrived {localTime(visitor.arrivedAt)}</p></div><Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg" onClick={() => { setDepartureTarget({ id: visitor.id, version: visitor.version, name: visitor.name }); setDepartureNotes(""); }} disabled={depart.isPending}><LogOut className="mr-1.5 h-3.5 w-3.5" />Check out</Button></article>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No visitors are currently logged at this property.</p>}{departureTarget && <div className="mt-3 rounded-xl border border-primary/25 bg-primary/5 p-3"><p className="text-sm font-extrabold">Check out {departureTarget.name || "protected visitor"}</p><div className="mt-2 grid gap-1.5"><Label htmlFor="visitor-departure-notes">Departure note <span className="font-normal text-muted-foreground">(optional)</span></Label><DictationTextarea id="visitor-departure-notes" value={departureNotes} onChange={event => setDepartureNotes(event.target.value)} className="min-h-20 rounded-xl" placeholder="For example: left independently at 16:15; no concerns raised." /></div><div className="mt-3 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => { setDepartureTarget(null); setDepartureNotes(""); }}>Cancel</Button><Button size="sm" onClick={confirmDeparture} disabled={depart.isPending}><LogOut className="mr-1.5 h-3.5 w-3.5" />{depart.isPending ? "Checking out…" : "Confirm departure"}</Button></div></div>} {departedVisitors.length ? <div className="mt-5"><p className="text-sm font-extrabold">Recent departures</p><div className="mt-2 space-y-2">{departedVisitors.map(visitor => <article key={visitor.id} className="rounded-xl border border-border/70 px-3 py-2.5"><p className="text-sm font-bold">{visitor.name || "Protected visitor"}</p><p className="mt-0.5 text-xs text-muted-foreground">Departed {visitor.departedAt ? localTime(visitor.departedAt) : "time unavailable"}</p>{visitor.departureNotes ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{visitor.departureNotes}</p> : null}</article>)}</div></div> : null}</section>}</DialogContent></Dialog>;
}
