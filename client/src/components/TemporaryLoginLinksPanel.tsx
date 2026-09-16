import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DictationTextarea } from "@/components/DictationFields";
import { trpc } from "@/lib/trpc";
import { Copy, KeyRound, Link2, ShieldAlert, XCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Member = {
  userId: number;
  name: string | null;
  email: string | null;
  status: string;
  accountStatus?: string;
  hasLocalCredential?: boolean;
};

export function TemporaryLoginLinksPanel({ entityId, members }: { entityId: number; members: Member[] }) {
  const [open, setOpen] = useState(false);
  const [targetUserId, setTargetUserId] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("7");
  const [reason, setReason] = useState("");
  const [created, setCreated] = useState<{ token: string; expiresAt: number } | null>(null);
  const utils = trpc.useUtils();
  const list = trpc.temporaryLoginLinks.list.useQuery({ entityId }, { staleTime: 20_000 });
  const issue = trpc.temporaryLoginLinks.issue.useMutation({
    onSuccess: result => {
      setCreated({ token: result.token, expiresAt: result.expiresAt });
      utils.temporaryLoginLinks.list.invalidate({ entityId });
      toast.success("One-time sign-in link created. Copy it now; it will not be shown again.");
    },
    onError: error => toast.error(error.message),
  });
  const revoke = trpc.temporaryLoginLinks.revoke.useMutation({
    onSuccess: () => {
      utils.temporaryLoginLinks.list.invalidate({ entityId });
      toast.success("Temporary sign-in link revoked.");
    },
    onError: error => toast.error(error.message),
  });
  const eligibleMembers = members.filter(member => member.status === "active" && member.accountStatus === "active" && member.hasLocalCredential === true && Boolean(member.email));
  const link = created ? `${window.location.origin}/access/temporary/${created.token}` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Temporary sign-in link copied. Send it only through an approved secure channel.");
    } catch {
      toast.error("Copy failed. Select the link and copy it manually.");
    }
  };
  const resetForm = () => { setCreated(null); setTargetUserId(""); setExpiresInDays("7"); setReason(""); };

  return <section className="surface overflow-hidden">
    <div className="flex flex-col gap-4 border-b border-border/70 p-5 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="flex items-center gap-2 font-extrabold"><KeyRound className="h-4 w-4" />Account-specific temporary sign-in links</p>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">Create one revocable, single-use link for an existing active account in this company. It never creates a user, role, membership or property grant; the recipient’s current access is rechecked at sign-in.</p>
      </div>
      <Dialog open={open} onOpenChange={next => { setOpen(next); if (!next) resetForm(); }}>
        <DialogTrigger asChild><Button className="rounded-xl"><Link2 className="mr-2 h-4 w-4" />Create temporary link</Button></DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Create account-specific temporary access</DialogTitle><DialogDescription>This link can be redeemed once and expires after no more than 30 days. It creates a normal local session for the selected account and cannot override forced password change, account status, company membership, role or property scope.</DialogDescription></DialogHeader>
          {created ? <div className="grid gap-4 py-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950"><p className="font-extrabold">Copy this link now</p><p className="mt-1">It is not retained in the access list or shown again after this dialog closes. Send it only through an approved secure channel.</p></div>
            <Input value={link} readOnly aria-label="One-time temporary sign-in link" className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">Expires {new Date(created.expiresAt).toLocaleString("en-GB")}. A password reset or account suspension is required to revoke a session after the link has already been redeemed.</p>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Close</Button><Button onClick={copyLink}><Copy className="mr-2 h-4 w-4" />Copy temporary link</Button></DialogFooter>
          </div> : <div className="grid gap-4 py-2">
            <Field label="Existing active company account"><Select value={targetUserId} onValueChange={setTargetUserId}><SelectTrigger><SelectValue placeholder="Choose an existing account" /></SelectTrigger><SelectContent>{eligibleMembers.map(member => <SelectItem key={member.userId} value={String(member.userId)}>{member.name ?? "Unnamed account"} — {member.email}</SelectItem>)}</SelectContent></Select></Field>
            {!eligibleMembers.length && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">No active local accounts are available. Create or reactivate an approved company account with local credentials first.</div>}
            <Field label="Link expiry"><Select value={expiresInDays} onValueChange={setExpiresInDays}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1">1 day</SelectItem><SelectItem value="7">7 days</SelectItem><SelectItem value="14">14 days</SelectItem><SelectItem value="30">30 days (maximum)</SelectItem></SelectContent></Select></Field>
            <Field label="Business reason"><DictationTextarea value={reason} onChange={event => setReason(event.target.value)} placeholder="For example: Verified recovery request received from the active colleague after a lost device report." /><p className="text-xs text-muted-foreground">At least 20 characters. The reason and link lifecycle are recorded in the restricted audit trail; the raw link is never recorded.</p></Field>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={issue.isPending || !targetUserId || reason.trim().length < 20} onClick={() => issue.mutate({ entityId, targetUserId: Number(targetUserId), expiresInDays: Number(expiresInDays), reason })}>{issue.isPending ? "Creating…" : "Create one-time link"}</Button></DialogFooter>
          </div>}
        </DialogContent>
      </Dialog>
    </div>
    <div className="divide-y divide-border/70">
      {list.isLoading ? <p className="p-5 text-sm text-muted-foreground">Loading temporary sign-in links…</p> : list.data?.length ? list.data.map(item => <LinkRow key={item.id} item={item} pending={revoke.isPending} onRevoke={reasonValue => revoke.mutate({ entityId, id: item.id, reason: reasonValue })} />) : <p className="p-5 text-sm text-muted-foreground">No temporary sign-in links have been created for this company.</p>}
    </div>
  </section>;
}

function LinkRow({ item, pending, onRevoke }: { item: any; pending: boolean; onRevoke: (reason: string) => void }) {
  const status = item.redeemedAt ? "Used" : item.revokedAt ? "Revoked" : item.expiresAt <= Date.now() ? "Expired" : "Active";
  return <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate font-bold">{item.recipientName ?? "Unnamed account"}</p><Badge variant={status === "Active" ? "secondary" : "outline"}>{status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{item.recipientEmail ?? "No email recorded"} · expires {new Date(item.expiresAt).toLocaleString("en-GB")}{item.redeemedAt ? ` · used ${new Date(item.redeemedAt).toLocaleString("en-GB")}` : ""}</p></div>{status === "Active" ? <RevokeDialog pending={pending} onRevoke={onRevoke} /> : null}</div>;
}

function RevokeDialog({ pending, onRevoke }: { pending: boolean; onRevoke: (reason: string) => void }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="outline" className="rounded-xl"><XCircle className="mr-2 h-4 w-4" />Revoke</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>Revoke temporary sign-in link</DialogTitle><DialogDescription>This prevents the unused link from creating a session. It does not change the recipient’s existing role, membership, property scope or password.</DialogDescription></DialogHeader><Field label="Reason for revocation"><DictationTextarea value={reason} onChange={event => setReason(event.target.value)} placeholder="For example: The recovery request has been resolved and the link is no longer required." /><p className="text-xs text-muted-foreground">At least 20 characters. The reason is recorded in the restricted audit trail.</p></Field><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button variant="destructive" disabled={pending || reason.trim().length < 20} onClick={() => { onRevoke(reason); setOpen(false); }}>{pending ? "Revoking…" : "Revoke link"}</Button></DialogFooter></DialogContent></Dialog>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <div className="grid gap-2"><Label>{label}</Label>{children}</div>; }
