import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, PageHeader } from "@/components/app/Primitives";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { trpc } from "@/lib/trpc";
import { Loader2, Lock, Plus, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Everything on this screen — roles, capabilities, pages, people — comes from
 * the server, and this is the shape roleManagement.workspace returns.
 *
 * It is written out rather than inferred because the API is PHP
 * (laravel/app/Trpc/Routers/RoleManagementRouter.php) and there is nothing to
 * infer from. This is the one screen where the shape is worth stating: it
 * renders a permission matrix, and a field quietly going missing would show as
 * an empty column rather than an error.
 */
type Role = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  isBuiltIn: boolean;
  isAdminAccount: boolean;
  memberCount: number;
  availablePaths: string[];
  baseCapabilities: string[];
  baseRole: string;
  grantedCapabilities: string[];
  deniedCapabilities: string[];
  visiblePaths: string[] | null;
  effectiveCapabilities: string[];
  effectivePaths: string[];
  delta: { added: string[]; removed: string[] };
};

type Workspace = {
  roles: Role[];
  pages: Array<{ path: string; label: string }>;
  grantableCapabilities: Array<{ value: string; label: string }>;
  allCapabilities: Array<{ value: string; label: string }>;
  properties: Array<{ id: number; name: string; addressLine1: string | null }>;
  members: Array<{
    userId: number;
    name: string | null;
    email: string | null;
    role: string;
    roleId: number | null;
    allProperties: boolean;
    extraCapabilities: string[];
    propertyIds: number[];
    status: string;
    accountStatus: string;
    hasLocalCredential: boolean;
  }>;
};

type RoleDraft = {
  id: number | null;
  name: string;
  description: string;
  baseRole: string;
  granted: string[];
  denied: string[];
  paths: string[];
  reason: string;
  isBuiltIn: boolean;
};

export default function RoleManagement() {
  const { entityId } = useWorkspace();
  const utils = trpc.useUtils();
  const query = trpc.roleManagement.workspace.useQuery({ entityId: entityId! }, { enabled: Boolean(entityId), staleTime: 15_000 });
  const [draft, setDraft] = useState<RoleDraft | null>(null);
  const [personFor, setPersonFor] = useState<number | null | "new">(null);

  const refresh = async () => {
    await utils.roleManagement.workspace.invalidate();
    await utils.workspace.myNavigation.invalidate();
  };

  if (!entityId) return <EmptyState icon={Lock} title="Select a company first" description="Roles are defined separately for each company." />;
  if (query.isLoading) return <div className="grid place-items-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (query.error) return <EmptyState icon={Lock} title="You cannot manage roles here" description={query.error.message} />;
  const data = query.data!;

  const newDraft = (): RoleDraft => ({
    id: null, name: "", description: "", baseRole: data.roles.find(role => role.isBuiltIn && !role.isAdminAccount)?.baseRole ?? "read_only",
    granted: [], denied: [], paths: [], reason: "", isBuiltIn: false,
  });
  const editDraft = (role: Role): RoleDraft => ({
    id: role.id, name: role.name, description: role.description ?? "", baseRole: role.baseRole,
    granted: role.grantedCapabilities, denied: role.deniedCapabilities,
    paths: role.visiblePaths ?? role.effectivePaths, reason: "", isBuiltIn: role.isBuiltIn,
  });
  const labelFor = (path: string) => data.pages.find(page => page.path === path)?.label ?? path;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Roles & permissions"
        description="Every role in this workspace, what it may do and which pages it sees. Editing a role applies to everyone holding it."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setPersonFor("new")}><UserPlus className="mr-2 h-4 w-4" />New user</Button>
            <Button onClick={() => setDraft(newDraft())}><Plus className="mr-2 h-4 w-4" />New role</Button>
          </div>
        }
      />

      <section className="overflow-hidden rounded-2xl border border-border/60">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr><th className="p-3">Role</th><th className="p-3">Based on</th><th className="p-3">Capabilities</th><th className="p-3">Pages</th><th className="p-3">People</th><th className="p-3" /></tr>
          </thead>
          <tbody>
            {data.roles.map(role => (
              <tr key={role.id} className="border-t border-border/60 align-top">
                <td className="p-3">
                  <div className="flex items-center gap-2 font-medium">
                    {role.name}
                    {role.isBuiltIn ? <Badge variant="outline" className="text-[10px]">Built-in</Badge> : null}
                    {role.status === "archived" ? <Badge variant="secondary" className="text-[10px]">Archived</Badge> : null}
                  </div>
                  {role.description ? <p className="mt-1 max-w-md text-xs text-muted-foreground">{role.description}</p> : null}
                </td>
                <td className="p-3 text-xs text-muted-foreground">{role.baseRole}</td>
                <td className="p-3 text-xs">
                  {role.effectiveCapabilities.length}
                  {role.delta.added.length ? <span className="ml-2 text-emerald-600">+{role.delta.added.length}</span> : null}
                  {role.delta.removed.length ? <span className="ml-2 text-red-600">−{role.delta.removed.length}</span> : null}
                </td>
                <td className="p-3 text-xs text-muted-foreground">{role.effectivePaths.length} of {role.availablePaths.length}</td>
                <td className="p-3 text-xs text-muted-foreground">{role.memberCount}</td>
                <td className="p-3 text-right"><Button size="sm" variant="ghost" onClick={() => setDraft(editDraft(role))}>Edit</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground">People</h2>
        {data.members.length === 0
          ? <EmptyState icon={UserPlus} title="No members yet" description="Create the first account for this company." actionLabel="New user" onAction={() => setPersonFor("new")} />
          : <div className="overflow-hidden rounded-2xl border border-border/60">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="p-3">Person</th><th className="p-3">Role</th><th className="p-3">Properties</th><th className="p-3">Status</th><th className="p-3" /></tr>
                </thead>
                <tbody>
                  {data.members.map(member => (
                    <tr key={member.userId} className="border-t border-border/60">
                      <td className="p-3"><div className="font-medium">{member.name ?? "—"}</div><div className="text-xs text-muted-foreground">{member.email}</div></td>
                      <td className="p-3 text-xs">{data.roles.find(role => role.id === member.roleId)?.name ?? member.role}</td>
                      <td className="p-3 text-xs text-muted-foreground">{member.allProperties ? "All properties" : `${member.propertyIds.length} selected`}</td>
                      <td className="p-3"><Badge variant={member.status === "active" ? "secondary" : "outline"}>{member.status}</Badge></td>
                      <td className="p-3 text-right"><Button size="sm" variant="ghost" onClick={() => setPersonFor(member.userId)}>Change role</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
      </section>

      {draft && <RoleDialog entityId={entityId} draft={draft} data={data} labelFor={labelFor} onClose={() => setDraft(null)} onDone={refresh} />}
      {personFor !== null && <PersonDialog entityId={entityId} userId={personFor === "new" ? null : personFor} data={data} onClose={() => setPersonFor(null)} onDone={refresh} />}
    </div>
  );
}

function RoleDialog({ entityId, draft, data, labelFor, onClose, onDone }: {
  entityId: number; draft: RoleDraft; data: Workspace; labelFor: (path: string) => string;
  onClose: () => void; onDone: () => Promise<void>;
}) {
  const [form, setForm] = useState(draft);
  const selected = data.roles.find(role => role.baseRole === form.baseRole && role.isBuiltIn);
  const availablePaths = selected?.availablePaths ?? [];
  const baseCapabilities = selected?.baseCapabilities ?? [];
  const existing = form.id ? data.roles.find(role => role.id === form.id) : null;

  const onSuccess = async () => { toast.success(form.id ? "Role updated" : "Role created"); onClose(); await onDone(); };
  const onError = (issue: { message: string }) => toast.error(issue.message);
  const create = trpc.roleManagement.createRole.useMutation({ onSuccess, onError });
  const update = trpc.roleManagement.updateRole.useMutation({ onSuccess, onError });
  const archive = trpc.roleManagement.archiveRole.useMutation({
    onSuccess: async () => { toast.success("Role archived"); onClose(); await onDone(); }, onError,
  });
  const pending = create.isPending || update.isPending || archive.isPending;

  const missing = [
    form.name.trim().length < 2 && "a name",
    !form.paths.length && "at least one page",
  ].filter(Boolean) as string[];

  const toggle = (key: "granted" | "denied" | "paths", value: string) => setForm(current => ({
    ...current,
    [key]: current[key].includes(value) ? current[key].filter(item => item !== value) : [...current[key], value],
  }));

  const submit = () => {
    if (missing.length) { toast.error(`Add ${missing.join(" and ")} before saving.`); return; }
    const payload = {
      entityId,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      baseRole: form.baseRole as never,
      grantedCapabilities: form.granted,
      deniedCapabilities: form.denied,
      visiblePaths: form.paths.filter(path => availablePaths.includes(path)),
      reason: form.reason.trim() || undefined,
    };
    if (form.id) update.mutate({ ...payload, id: form.id });
    else create.mutate(payload);
  };

  return (
    <Dialog open onOpenChange={next => { if (!next && !pending) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{form.id ? form.name : "New role"}</DialogTitle>
          <DialogDescription>
            {form.isBuiltIn
              ? "A built-in role keeps its identity, so it cannot be re-based or archived. You can still change what it may do and which pages it sees."
              : "Pick a role to start from, then add capabilities, take them away, and choose the pages. A role can never reach past what it is based on."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="role-name">Name</Label>
              <Input id="role-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Night Lead" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-base">Based on</Label>
              <Select
                value={form.baseRole}
                disabled={form.isBuiltIn}
                onValueChange={value => setForm({ ...form, baseRole: value, granted: [], denied: [], paths: data.roles.find(role => role.isBuiltIn && role.baseRole === value)?.availablePaths ?? [] })}
              >
                <SelectTrigger id="role-base"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {data.roles.filter(role => role.isBuiltIn && role.baseRole !== "platform_admin").map(role => (
                    <SelectItem key={role.id} value={role.baseRole}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Input id="role-description" value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Add capabilities</legend>
            <p className="text-xs text-muted-foreground">Only these may be added. Everything else stays with the role it is based on.</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {data.grantableCapabilities.map(capability => (
                <label key={capability.value} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.granted.includes(capability.value)} disabled={form.denied.includes(capability.value)} onCheckedChange={() => toggle("granted", capability.value)} />
                  <span title={capability.label}>{capability.value}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Remove capabilities</legend>
            <p className="text-xs text-muted-foreground">A removal always wins over an addition.</p>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border border-border/60 p-2 sm:grid-cols-2">
              {baseCapabilities.map(capability => (
                <label key={capability} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.denied.includes(capability)} onCheckedChange={() => toggle("denied", capability)} />
                  <span>{capability}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Pages ({form.paths.length} of {availablePaths.length})</legend>
            <div className="grid max-h-48 gap-1 overflow-y-auto rounded-xl border border-border/60 p-2 sm:grid-cols-2">
              {availablePaths.map(path => (
                <label key={path} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.paths.includes(path)} onCheckedChange={() => toggle("paths", path)} />
                  <span>{labelFor(path)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="role-reason">Reason for the audit trail (optional)</Label>
            <Textarea id="role-reason" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} placeholder="Optional — recorded in the audit trail." />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          {existing && !existing.isBuiltIn && existing.status === "active"
            ? <Button variant="ghost" className="text-destructive" disabled={pending}
                onClick={() => archive.mutate({ entityId, id: existing.id, reason: form.reason.trim() || undefined })}>Archive</Button>
            : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
            <Button onClick={submit} disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PersonDialog({ entityId, userId, data, onClose, onDone }: {
  entityId: number; userId: number | null; data: Workspace; onClose: () => void; onDone: () => Promise<void>;
}) {
  const member = userId === null ? null : data.members.find(item => item.userId === userId);
  const assignable = data.roles.filter(role => role.status === "active" && role.baseRole !== "platform_admin");
  const [form, setForm] = useState({
    email: "", name: member?.name ?? "", temporaryPassword: "", reason: "",
    roleId: member?.roleId ?? assignable[0]?.id ?? null,
    allProperties: member?.allProperties ?? true,
    propertyIds: (member?.propertyIds ?? []) as number[],
  });
  const onError = (issue: { message: string }) => toast.error(issue.message);
  const create = trpc.roleManagement.createUser.useMutation({
    onSuccess: async result => { toast.success(result.created ? "Account created" : "Account re-provisioned"); onClose(); await onDone(); }, onError,
  });
  const assign = trpc.roleManagement.assignRole.useMutation({
    onSuccess: async () => { toast.success("Role updated"); onClose(); await onDone(); }, onError,
  });
  const pending = create.isPending || assign.isPending;
  const role = assignable.find(item => item.id === form.roleId);

  // The button stays clickable; anything missing is reported when it is pressed.
  const missing = [
    !form.roleId && "a role",
    !member && form.name.trim().length < 2 && "a full name",
    !member && !form.email.includes("@") && "an email address",
    !member && form.temporaryPassword.length < 6 && "a temporary password of at least 6 characters",
    !form.allProperties && !form.propertyIds.length && "at least one property",
  ].filter(Boolean) as string[];

  const submit = () => {
    if (missing.length) { toast.error(`Add ${missing.join(", ")} before saving.`); return; }
    const shared = {
      entityId, roleId: form.roleId, role: (role?.baseRole ?? "read_only") as never,
      allProperties: form.allProperties, propertyIds: form.propertyIds,
      extraCapabilities: [] as never, reason: form.reason.trim() || undefined,
    };
    if (member) assign.mutate({ ...shared, targetUserId: member.userId });
    else create.mutate({ ...shared, email: form.email.trim(), name: form.name.trim(), temporaryPassword: form.temporaryPassword });
  };

  return (
    <Dialog open onOpenChange={next => { if (!next && !pending) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? "Change role" : "New user"}</DialogTitle>
          <DialogDescription>{member ? `${member.name ?? member.email}` : "The account starts with a temporary password that must be changed on first sign-in."}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!member && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="person-name">Full name</Label><Input id="person-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
                <div className="space-y-2"><Label htmlFor="person-email">Email</Label><Input id="person-email" type="email" autoComplete="off" value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="person-password">Temporary password</Label>
                <Input id="person-password" autoComplete="new-password" value={form.temporaryPassword} onChange={event => setForm({ ...form, temporaryPassword: event.target.value })} />
                <p className="text-xs text-muted-foreground">At least 6 characters, using three of: lowercase, uppercase, number, symbol.</p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="person-role">Role</Label>
            <Select value={form.roleId ? String(form.roleId) : ""} onValueChange={value => setForm({ ...form, roleId: Number(value) })}>
              <SelectTrigger id="person-role"><SelectValue placeholder="Select a role" /></SelectTrigger>
              <SelectContent>
                {assignable.map(item => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {role ? <p className="text-xs text-muted-foreground">{role.effectiveCapabilities.length} capabilities · {role.effectivePaths.length} pages</p> : null}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Properties</legend>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={form.allProperties} onCheckedChange={() => setForm({ ...form, allProperties: !form.allProperties, propertyIds: [] })} />
              <span>All company properties</span>
            </label>
            {!form.allProperties && (
              data.properties.length === 0
                ? <p className="text-xs text-muted-foreground">This company has no properties yet, so choose all-property access for now.</p>
                : <div className="grid gap-1 rounded-xl border border-border/60 p-2 sm:grid-cols-2">
                    {data.properties.map(property => (
                      <label key={property.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={form.propertyIds.includes(property.id)}
                          onCheckedChange={() => setForm({
                            ...form,
                            propertyIds: form.propertyIds.includes(property.id)
                              ? form.propertyIds.filter(id => id !== property.id)
                              : [...form.propertyIds, property.id],
                          })}
                        />
                        <span>{property.name ?? property.addressLine1}</span>
                      </label>
                    ))}
                  </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="person-reason">Reason for the audit trail (optional)</Label>
            <Textarea id="person-reason" value={form.reason} onChange={event => setForm({ ...form, reason: event.target.value })} placeholder="Optional — recorded in the audit trail." />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button disabled={pending} onClick={submit}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{member ? "Save" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
