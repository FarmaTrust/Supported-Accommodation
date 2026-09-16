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

const readable = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

export function VisitorLogDialog({ entityId, properties, open, onOpenChange, initialPropertyId }: { entityId: number; properties: PropertyOption[]; open: boolean; onOpenChange: (open: boolean) => void; initialPropertyId?: number }) {
  const [propertyId, setPropertyId] = useState("");
  const [visitorType, setVisitorType] = useState<VisitorType>("professional");
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [purpose, setPurpose] = useState("");
  const [idCheckStatus, setIdCheckStatus] = useState<IdCheckStatus>("not_checked");
  const [notes, setNotes] = useState("");
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
      toast.success("Visitor checked out", { description: "The departure time is recorded in the property log." });
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
  const activeVisitors = (workspace.data?.visitors ?? []).filter(visitor => visitor.status === "on_site" || visitor.status === "overdue");

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Visitor log</DialogTitle><DialogDescription>Record arrivals and departures at an authorised property. Visitor names and notes are encrypted; do not record more personal information than required.</DialogDescription></DialogHeader><div className="grid gap-3 py-1"><div className="grid gap-1.5"><Label>Property</Label><Select value={propertyId} onValueChange={setPropertyId}><SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Choose an authorised property" /></SelectTrigger><SelectContent>{properties.map(property => <SelectItem key={property.id} value={String(property.id)}>{property.name}{property.addressLine1 ? ` · ${property.addressLine1}` : ""}</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div className="grid gap-1.5"><Label>Visitor type</Label><Select value={visitorType} onValueChange={value => setVisitorType(value as VisitorType)}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{(["friend", "relative", "professional", "contractor", "public_official", "other"] as const).map(value => <SelectItem key={value} value={value}>{readable(value)}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1.5"><Label>ID check</Label><Select value={idCheckStatus} onValueChange={value => setIdCheckStatus(value as IdCheckStatus)}><SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger><SelectContent>{(["not_required", "not_checked", "verified", "declined", "unavailable"] as const).map(value => <SelectItem key={value} value={value}>{readable(value)}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-1.5"><Label htmlFor="visitor-name">Name</Label><Input id="visitor-name" value={name} onChange={event => setName(event.target.value)} className="h-10 rounded-xl" placeholder="Visitor's name" /></div><div className="grid gap-1.5"><Label htmlFor="visitor-relationship">Relationship or organisation</Label><Input id="visitor-relationship" value={relationship} onChange={event => setRelationship(event.target.value)} className="h-10 rounded-xl" placeholder="Optional" /></div><div className="grid gap-1.5"><Label htmlFor="visitor-purpose">Purpose of visit</Label><Input id="visitor-purpose" value={purpose} onChange={event => setPurpose(event.target.value)} className="h-10 rounded-xl" placeholder="For example: planned professional meeting" /></div><div className="grid gap-1.5"><Label htmlFor="visitor-notes">Notes</Label><DictationTextarea id="visitor-notes" value={notes} onChange={event => setNotes(event.target.value)} className="min-h-20 rounded-xl" placeholder="Optional factual notes only" /></div></div><DialogFooter className="gap-2 sm:gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={arrive.isPending}>Close</Button><Button onClick={submit} disabled={arrive.isPending || !selectedPropertyId || name.trim().length < 2 || purpose.trim().length < 2}><LogIn className="mr-2 h-4 w-4" />{arrive.isPending ? "Logging…" : "Log arrival"}</Button></DialogFooter>{selectedPropertyId && <section className="mt-2 border-t border-border/70 pt-4"><div className="flex items-center gap-2"><UsersRound className="h-4 w-4 text-primary" /><div><p className="text-sm font-extrabold">Visitors currently on site</p><p className="text-xs text-muted-foreground">Use checkout when a visitor leaves; the server verifies property access and record version.</p></div></div>{workspace.isLoading ? <p className="mt-3 text-sm text-muted-foreground">Loading visitor log…</p> : activeVisitors.length ? <div className="mt-3 space-y-2">{activeVisitors.map(visitor => <article key={visitor.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-bold">{visitor.name || "Protected visitor"}</p><p className="truncate text-xs text-muted-foreground">{readable(visitor.visitorType)} · arrived {new Date(visitor.arrivedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p></div><Button size="sm" variant="outline" className="h-9 shrink-0 rounded-lg" onClick={() => depart.mutate({ entityId, visitorId: visitor.id, expectedVersion: visitor.version })} disabled={depart.isPending}><LogOut className="mr-1.5 h-3.5 w-3.5" />Check out</Button></article>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No visitors are currently logged at this property.</p>}</section>}</DialogContent></Dialog>;
}
