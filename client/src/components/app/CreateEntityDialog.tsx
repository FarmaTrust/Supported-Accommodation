import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { Building2, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export function CreateEntityDialog({ first = false }: { first?: boolean }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", legalName: "", companyNumber: "", ofstedUrn: "", email: "", invoicePrefix: "INV" });
  const utils = trpc.useUtils();
  const create = trpc.entities.create.useMutation({
    onSuccess: async () => { await utils.entities.list.invalidate(); setOpen(false); toast.success("Entity created", { description: "You can now add properties, staff and authority details." }); },
    onError: error => toast.error("Could not create entity", { description: error.message }),
  });
  const set = (key: keyof typeof form, value: string) => setForm(current => ({ ...current, [key]: value }));
  const submit = () => create.mutate({ ...form, companyNumber: form.companyNumber || undefined, ofstedUrn: form.ofstedUrn || undefined, email: form.email || undefined, invoicePrefix: form.invoicePrefix.toUpperCase(), defaultVatRate: 0 });
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size={first ? "lg" : "default"} className="rounded-xl"><Plus className="mr-2 h-4 w-4" />{first ? "Set up first entity" : "Add entity"}</Button></DialogTrigger><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Create legal entity</DialogTitle><DialogDescription>Entity details become the trusted source for packs and invoice headers. Bank details are configured separately and remain restricted.</DialogDescription></DialogHeader><div className="grid gap-5 py-3 sm:grid-cols-2"><Field label="Workspace name" value={form.name} onChange={value => set("name", value)} placeholder="North Region" /><Field label="Registered legal name" value={form.legalName} onChange={value => set("legalName", value)} placeholder="Provider Services Ltd" /><Field label="Company number" value={form.companyNumber} onChange={value => set("companyNumber", value)} placeholder="Optional" /><Field label="Ofsted URN" value={form.ofstedUrn} onChange={value => set("ofstedUrn", value)} placeholder="If registered" /><Field label="Main email" value={form.email} onChange={value => set("email", value)} type="email" placeholder="operations@example.org" /><Field label="Invoice prefix" value={form.invoicePrefix} onChange={value => set("invoicePrefix", value)} placeholder="INV" /></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={submit} disabled={create.isPending || form.name.length < 2 || form.legalName.length < 2}>{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create entity</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, value, onChange, placeholder, type = "text" }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string }) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return <div className="grid gap-2"><Label htmlFor={id}>{label}</Label><Input id={id} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} type={type} className="h-11 rounded-xl" /></div>;
}
