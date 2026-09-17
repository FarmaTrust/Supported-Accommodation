import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { canViewWorkspaceNavigation } from "@/lib/roleNavigation";
import { getAuthFeedback, isAuthFeedbackCode, type AuthFeedback } from "@shared/authFeedback";
import { useIsMobile } from "@/hooks/useMobile";
import { NotificationSoundControl, useNotificationSound } from "@/hooks/useNotificationSound";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle, BellRing, BookOpenText, Building2, CalendarClock, CalendarDays, ClipboardCheck, FileStack, HandCoins, HeartPulse, House, LayoutDashboard, Loader2, Scale,
  Eye, EyeOff, KeyRound, ListTodo, LogOut, Menu, PanelLeft, ScanSearch, Search, ShieldAlert, ShieldCheck, Smartphone, UserRound, UsersRound, Wifi, WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const menuItems = [
  { icon: LayoutDashboard, label: "Overview", path: "/" },
  { icon: Building2, label: "Properties", path: "/properties" },
  { icon: UsersRound, label: "Workforce", path: "/workforce" },
  { icon: KeyRound, label: "Access control", path: "/access-control" },
  { icon: LayoutDashboard, label: "RSM App", path: "/manager-app" },
  { icon: ShieldCheck, label: "Nominated Individual App", path: "/nominated-individual" },
  { icon: UserRound, label: "Staff workspace", path: "/staff" },
  { icon: BookOpenText, label: "Young people", path: "/placements" },
  { icon: CalendarDays, label: "Rota & shifts", path: "/rota" },
  { icon: CalendarClock, label: "Rota controls", path: "/rota-controls" },
  { icon: ShieldCheck, label: "Compliance dashboard", path: "/compliance-dashboard" },
  { icon: BellRing, label: "Compliance calendar", path: "/compliance" },
  { icon: Scale, label: "Governance & outcomes", path: "/governance" },
  { icon: ListTodo, label: "Work plans", path: "/work-plans" },
  { icon: HandCoins, label: "Finance", path: "/finance" },
  { icon: FileStack, label: "Documents & packs", path: "/documents" },
  { icon: ScanSearch, label: "Assurance", path: "/assurance" },
  { icon: ClipboardCheck, label: "Quality reviews", path: "/quality-reviews" },
  { icon: BellRing, label: "Regulation 28", path: "/regulation-28" },
  { icon: HeartPulse, label: "Care & health", path: "/care" },
  { icon: ShieldAlert, label: "Safeguarding", path: "/safeguarding" },
  { icon: Smartphone, label: "Keyworker App", path: "/keyworker-app" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, authIssue, passwordChangeRequired, phoneCaptureRequired } = useAuth();
  if (loading || !user) return <SignInScreen loading={loading} feedback={authIssue} />;
  if (passwordChangeRequired) return <SignInScreen loading={false} feedback={null} forcePasswordChange />;
  return <WorkspaceProvider><SidebarProvider><DashboardLayoutContent>{children}</DashboardLayoutContent><PhoneCaptureDialog required={phoneCaptureRequired} /></SidebarProvider></WorkspaceProvider>;
}

function SignInScreen({ loading, feedback, forcePasswordChange = false }: { loading: boolean; feedback: AuthFeedback | null; forcePasswordChange?: boolean }) {
  const [queryFeedback, setQueryFeedback] = useState<AuthFeedback | null>(null);
  const [resetToken] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("resetToken") ?? params.get("reset") ?? "";
  });
  const [mode, setMode] = useState<"sign-in" | "bootstrap" | "reset" | "reset-confirm" | "force-change">(forcePasswordChange ? "force-change" : resetToken ? "reset-confirm" : "sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [testingResetUrl, setTestingResetUrl] = useState<string | null>(null);
  const utils = trpc.useUtils();
  const bootstrapStatus = trpc.localAuth.bootstrapStatus.useQuery(undefined, { staleTime: 60_000, retry: false });
  const bootstrapAvailable = bootstrapStatus.data?.setupAvailable === true;
  const login = trpc.localAuth.login.useMutation({
    onSuccess: async () => { setNotice(null); await utils.auth.status.invalidate(); },
    onError: error => setNotice(error.message),
  });
  const bootstrap = trpc.localAuth.bootstrapOwner.useMutation({
    onSuccess: async () => { setNotice(null); await utils.auth.status.invalidate(); },
    onError: error => setNotice(error.message),
  });
  const resetRequest = trpc.localAuth.requestPasswordReset.useMutation({
    onSuccess: result => { setNotice(result.message); setTestingResetUrl(result.testingResetUrl ?? null); },
    onError: () => setNotice("We could not record that reset request. Please try again or contact your company administrator."),
  });
  const resetPassword = trpc.localAuth.resetPassword.useMutation({
    onSuccess: () => { setNotice("Password updated. You can now sign in with your new password."); setPassword(""); setMode("sign-in"); const params = new URLSearchParams(window.location.search); params.delete("reset"); params.delete("resetToken"); const query = params.toString(); window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`); },
    onError: error => setNotice(error.message),
  });
  const setMyPassword = trpc.localAuth.setMyPassword.useMutation({
    onSuccess: async () => { setNotice("Password updated. Your workspace is now available."); setPassword(""); setConfirmPassword(""); await utils.auth.status.invalidate(); },
    onError: error => setNotice(error.message),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("auth_error");
    const fromSession = window.sessionStorage.getItem("hub-auth-feedback");
    const code = isAuthFeedbackCode(fromUrl) ? fromUrl : isAuthFeedbackCode(fromSession) ? fromSession : null;
    if (code) {
      setQueryFeedback(getAuthFeedback(code));
      window.sessionStorage.removeItem("hub-auth-feedback");
      if (fromUrl) {
        params.delete("auth_error");
        const query = params.toString();
        window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      }
    }
  }, []);

  useEffect(() => {
    if (!feedback) setQueryFeedback(null);
  }, [feedback]);

  const visibleFeedback = feedback ?? queryFeedback;
  const busy = loading || login.isPending || bootstrap.isPending || resetRequest.isPending || resetPassword.isPending || setMyPassword.isPending;
  const submit = () => {
    setNotice(null);
    setTestingResetUrl(null);
    if (mode === "sign-in") login.mutate({ email, password });
    else if (mode === "bootstrap") bootstrap.mutate({ email, password, bootstrapToken });
    else if (mode === "reset-confirm") resetPassword.mutate({ token: resetToken, password });
    else if (mode === "force-change") {
      if (password !== confirmPassword) { setNotice("The new passwords do not match. Please enter them again."); return; }
      setMyPassword.mutate({ password });
    }
    else resetRequest.mutate({ email });
  };
  const requestHelp = () => {
    const body = ["Please describe the sign-in problem:", "", `Developer code: ${visibleFeedback?.code ?? "AUTH_SIGN_IN_REQUIRED"}`, `Page: ${window.location.pathname}`, "", "Do not include passwords, one-time codes or sensitive record details."].join("\n");
    window.location.href = `mailto:?subject=${encodeURIComponent("Supported Accommodation Hub sign-in support")}&body=${encodeURIComponent(body)}`;
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-10">
      <div className="geometry-blue absolute -left-24 top-12 h-64 w-64 rotate-12 rounded-[4rem]" />
      <div className="geometry-blush absolute -right-20 bottom-12 h-72 w-72 -rotate-12 rounded-full" />
      <section className="surface relative z-10 w-full max-w-lg p-8 sm:p-12" aria-labelledby="signin-title" aria-busy={busy}>
        <div className="mb-10 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-foreground text-background"><House className="h-5 w-5" /></div>
          <div><p className="font-extrabold tracking-[-0.04em]">Supported Accommodation</p><p className="text-xs text-muted-foreground">Operations hub</p></div>
        </div>
        <p className="eyebrow mb-3">Secure workspace</p>
        <h1 id="signin-title" className="text-4xl font-extrabold tracking-[-0.055em] sm:text-5xl">Clear work. Safer records.</h1>
        <p className="thin-copy mt-5 max-w-md">{forcePasswordChange ? "Choose a new password before accessing any operational records. This protects your company workspace after temporary or first-use credentials." : "Sign in with the email address and password issued by your company administrator. If the password is incorrect, check the details or use the reset link below. Your access is still limited to the companies, properties and records assigned to your role."}</p>
        {visibleFeedback && <div role="alert" className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-extrabold">{visibleFeedback.title}</p><p className="mt-1 text-sm leading-5">{visibleFeedback.message}</p><p className="mt-3 font-mono text-xs font-bold">Developer code: {visibleFeedback.code}</p></div></div></div>}
        {loading && !visibleFeedback && <div role="status" className="mt-6 flex items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Checking your secure session…</div>}
        {notice && <div role="alert" className="mt-5 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950">{notice}</div>}
        {testingResetUrl && <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-extrabold">TEST reset link — fictional account only</p><p className="mt-2 break-all rounded-lg bg-white/70 p-2 font-mono text-xs">{testingResetUrl}</p><Button type="button" variant="outline" className="mt-3 h-9 rounded-lg" onClick={() => void navigator.clipboard?.writeText(testingResetUrl)}>Copy test reset link</Button></div>}
        <div className="mt-7 grid gap-4">{mode !== "reset-confirm" && mode !== "force-change" && <label className="grid gap-2 text-sm font-bold">Email address<input autoComplete="email" type="email" value={email} onChange={event => setEmail(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none ring-ring focus:ring-2" placeholder="name@organisation.example" /></label>}{mode !== "reset" && <label className="grid gap-2 text-sm font-bold">{mode === "reset-confirm" || mode === "force-change" ? "New password" : "Password"}<span className="relative"><input autoComplete={mode === "bootstrap" || mode === "reset-confirm" || mode === "force-change" ? "new-password" : "current-password"} type={showPassword ? "text" : "password"} value={password} onChange={event => setPassword(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 pr-11 text-sm outline-none ring-ring focus:ring-2" placeholder={mode === "bootstrap" || mode === "reset-confirm" || mode === "force-change" ? "At least 14 characters" : "Enter your password"} /><button type="button" onClick={() => setShowPassword(value => !value)} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted-foreground hover:text-foreground" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></span></label>}{mode === "force-change" && <label className="grid gap-2 text-sm font-bold">Confirm new password<input autoComplete="new-password" type={showPassword ? "text" : "password"} value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none ring-ring focus:ring-2" placeholder="Re-enter your new password" /></label>}{mode === "bootstrap" && <label className="grid gap-2 text-sm font-bold">One-time owner setup token<input autoComplete="off" type="password" value={bootstrapToken} onChange={event => setBootstrapToken(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3 text-sm outline-none ring-ring focus:ring-2" placeholder="Provided securely to the owner" /></label>}</div>
        <Button onClick={submit} disabled={busy || (mode !== "reset-confirm" && mode !== "force-change" && !email) || (mode !== "reset" && !password) || (mode === "force-change" && password !== confirmPassword) || (mode === "bootstrap" && !bootstrapToken)} size="lg" className="mt-6 h-12 w-full rounded-xl text-base font-bold">{busy ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />{mode === "reset" ? "Recording request…" : "Saving securely…"}</> : mode === "bootstrap" ? "Set up owner sign-in" : mode === "reset" ? "Request password help" : mode === "reset-confirm" || mode === "force-change" ? "Set new password" : "Sign in securely"}</Button>
        {mode !== "reset-confirm" && mode !== "force-change" && <div className="mt-3 grid gap-2 sm:grid-cols-2"><Button variant="outline" onClick={() => { setMode(mode === "reset" ? "sign-in" : "reset"); setNotice(null); setTestingResetUrl(null); }} disabled={busy} className="rounded-xl text-sm font-semibold">{mode === "reset" ? "Back to sign in" : "Forgot password?"}</Button><Button variant="ghost" onClick={requestHelp} className="rounded-xl text-sm font-semibold">Email a support request</Button>{mode === "sign-in" && bootstrapAvailable && <Button variant="ghost" onClick={() => { setMode("bootstrap"); setNotice(null); setTestingResetUrl(null); }} className="sm:col-span-2 rounded-xl text-sm font-semibold">First owner setup</Button>}</div>}
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Passwords are stored only as salted one-way hashes. Access and sensitive record views are logged.</div>
      </section>
    </div>
  );
}

function NoWorkspaceAccess({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const feedback = getAuthFeedback("AUTH_NO_WORKSPACE_ACCESS");
  return <div className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-10"><div className="geometry-blue absolute -left-24 top-12 h-64 w-64 rotate-12 rounded-[4rem]" /><div className="geometry-blush absolute -right-20 bottom-12 h-72 w-72 -rotate-12 rounded-full" /><section className="surface relative z-10 w-full max-w-lg p-8 sm:p-12" aria-labelledby="access-title"><div className="mb-10 flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-foreground text-background"><House className="h-5 w-5" /></div><div><p className="font-extrabold tracking-[-0.04em]">Supported Accommodation</p><p className="text-xs text-muted-foreground">Operations hub</p></div></div><p className="eyebrow mb-3">Access review needed</p><h1 id="access-title" className="text-4xl font-extrabold tracking-[-0.055em] sm:text-5xl">{feedback.title}</h1><p className="thin-copy mt-5 leading-6">{feedback.message}</p><div role="alert" className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-mono font-bold">Developer code: {feedback.code}</p></div><Button variant="outline" onClick={() => void onSignOut()} size="lg" className="mt-8 h-12 w-full rounded-xl text-base font-bold">Sign out</Button></section></div>;
}

function Brand({ collapsed = false }: { collapsed?: boolean }) {
  return <div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-foreground text-background"><House className="h-4 w-4" /></div>{!collapsed && <div className="leading-tight"><p className="text-sm font-extrabold tracking-[-0.04em]">SA Hub</p><p className="text-[0.65rem] text-muted-foreground">Operations</p></div>}</div>;
}

function PhoneCaptureDialog({ required }: { required: boolean }) {
  const [open, setOpen] = useState(required);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const utils = trpc.useUtils();
  const save = trpc.localAuth.captureMyPhone.useMutation({
    onSuccess: async () => { await utils.auth.status.invalidate(); setOpen(false); setPhone(""); setError(""); },
    onError: issue => setError(issue.message),
  });
  useEffect(() => { if (required) setOpen(true); }, [required]);
  const submit = () => {
    if (!phone.trim()) { setError("Enter a phone number so the workspace can record your preferred contact route."); return; }
    setError("");
    save.mutate({ phone: phone.trim() });
  };
  return <Dialog open={open && required} onOpenChange={next => { if (!save.isPending) setOpen(next); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Add a contact phone number</DialogTitle><DialogDescription>On your first sign-in, add a phone number that your authorised manager can use for operational contact. It is stored as restricted account data and is not shown in this workspace.</DialogDescription></DialogHeader><div className="grid gap-2 py-2"><Label htmlFor="first-login-phone">Phone number</Label><Input id="first-login-phone" autoComplete="tel" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+44 7700 900000" className="h-11 rounded-xl" aria-invalid={Boolean(error)} /><p className="text-xs leading-5 text-muted-foreground">Use 7–20 digits with an optional leading + country code.</p>{error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p> : null}</div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>Remind me later</Button><Button onClick={submit} disabled={save.isPending}>{save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}Save phone number</Button></DialogFooter></DialogContent></Dialog>;
}

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const { entities, entityId, entity, setEntityId, loading } = useWorkspace();
  const isCollapsed = state === "collapsed";
  const isMobile = useIsMobile();
  const userNotifications = trpc.workspace.notifications.useQuery(undefined, { staleTime: 30_000, refetchInterval: 30_000 });
  const unreadNotificationCount = userNotifications.data?.filter(item => !item.readAt).length ?? 0;
  const notificationSound = useNotificationSound(userNotifications.data);
  const [accessFeedback, setAccessFeedback] = useState<AuthFeedback | null>(null);
  useEffect(() => {
    const onFeedback = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (isAuthFeedbackCode(code)) setAccessFeedback(getAuthFeedback(code));
    };
    window.addEventListener("hub-auth-feedback", onFeedback);
    return () => window.removeEventListener("hub-auth-feedback", onFeedback);
  }, []);
  useEffect(() => {
    if (user?.operationalRole !== "support_worker") return;
    const frontlinePaths = ["/keyworker-app", "/key-worker", "/properties", "/care", "/staff", "/search"];
    if (!frontlinePaths.some(path => location === path || location.startsWith(`${path}/`))) setLocation("/keyworker-app");
  }, [location, setLocation, user?.operationalRole]);
  const matchesLocation = (path: string) => path === location || (path !== "/" && location.startsWith(`${path}/`));
  const operationalMenuItems = menuItems.filter(item => canViewWorkspaceNavigation(user?.operationalRole, item.path)).sort((left, right) => {
    if (user?.operationalRole !== "support_worker") return 0;
    const frontlineOrder: Record<string, number> = { "/keyworker-app": 0, "/properties": 1, "/care": 2, "/staff": 3 };
    return (frontlineOrder[left.path] ?? 99) - (frontlineOrder[right.path] ?? 99);
  });
  const scopedMenuItems = user?.role === "admin" && user.operationalRole === "platform_admin"
    ? [...operationalMenuItems, { icon: ShieldAlert, label: "Superadmin", path: "/superadmin" }]
    : operationalMenuItems;
  const active = scopedMenuItems.find(item => matchesLocation(item.path));

  // ponytail: guard must sit after every hook, otherwise the empty-workspace render bails early and React throws "Rendered fewer hooks than expected".
  if (!loading && entities.length === 0 && user?.operationalRole !== "owner") return <NoWorkspaceAccess onSignOut={logout} />;

  return (
    <>
      <Sidebar data-print-chrome collapsible="icon" className="border-r border-sidebar-border/70 bg-sidebar">
        <SidebarHeader className="p-3">
          <div className="flex h-12 items-center justify-between gap-2 px-1">
            <Brand collapsed={isCollapsed} />
            {!isCollapsed && <button onClick={toggleSidebar} className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-sidebar-accent" aria-label="Collapse navigation"><PanelLeft className="h-4 w-4" /></button>}
          </div>
          {!isCollapsed && <Select value={entityId ? String(entityId) : ""} onValueChange={value => setEntityId(Number(value))} disabled={loading || !entities.length}>
            <SelectTrigger className="mt-2 h-11 w-full rounded-xl bg-background/80 text-left" aria-label="Current legal entity"><SelectValue placeholder={loading ? "Loading workspace…" : "No entity yet"} /></SelectTrigger>
            <SelectContent>{entities.map(entity => <SelectItem key={entity.id} value={String(entity.id)}>{entity.name}</SelectItem>)}</SelectContent>
          </Select>}
        </SidebarHeader>
        <SidebarContent className="px-2 py-3">
          <p className="eyebrow px-3 pb-2 group-data-[collapsible=icon]:hidden">Workspace</p>
          <SidebarMenu>
            {scopedMenuItems.map(item => {
              const selected = matchesLocation(item.path);
              return <SidebarMenuItem key={item.path}><SidebarMenuButton isActive={selected} onClick={() => setLocation(item.path)} tooltip={item.label} className="h-10 rounded-xl font-semibold"><item.icon className="h-4 w-4" /><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>;
            })}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Avatar className="h-9 w-9 border-0 bg-secondary"><AvatarFallback className="bg-secondary text-secondary-foreground text-xs font-bold">{user?.name?.slice(0, 1).toUpperCase() ?? "U"}</AvatarFallback></Avatar>{!isCollapsed && <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{user?.name ?? "User"}</p><p className="truncate text-[0.7rem] text-muted-foreground">{user?.operationalRole?.replaceAll("_", " ")}</p></div>}</button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52"><DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive"><LogOut className="mr-2 h-4 w-4" />Sign out</DropdownMenuItem></DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        {accessFeedback && <div role="alert" className="flex items-start gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 sm:px-6"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div className="min-w-0 flex-1"><p className="text-sm font-extrabold">{accessFeedback.title}</p><p className="mt-0.5 text-xs leading-5">{accessFeedback.message} <span className="font-mono font-bold">{accessFeedback.code}</span></p>{(entity?.supportEmail || entity?.supportPhone) && <p className="mt-2 text-xs font-semibold">Support: {entity.supportContactName ? `${entity.supportContactName} · ` : ""}{entity.supportEmail ?? entity.supportPhone}{entity.supportGuidance ? ` — ${entity.supportGuidance}` : ""}</p>}</div><button className="text-xs font-bold underline" onClick={() => setAccessFeedback(null)}>Dismiss</button></div>}
        <ConnectionStatus />
        <header data-print-chrome className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/88 px-4 backdrop-blur-xl sm:px-6">
          <SidebarTrigger className="h-10 w-10 rounded-xl"><Menu className="h-5 w-5" /></SidebarTrigger>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{active?.label ?? "Workspace"}</p><p className="truncate text-[0.68rem] text-muted-foreground">{entities.find(entity => entity.id === entityId)?.name ?? "Set up your first entity"}</p></div>
          <NotificationSoundControl enabled={notificationSound.enabled} supported={notificationSound.supported} onToggle={notificationSound.toggle} />
          <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0 rounded-xl bg-card" onClick={() => setLocation("/search?tab=notifications")} aria-label={unreadNotificationCount ? `${unreadNotificationCount} unread notifications` : "Notifications"}><BellRing className="h-4 w-4" />{unreadNotificationCount ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.65rem] font-extrabold text-primary-foreground">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span> : null}</Button>
          <Button variant="outline" className="h-10 rounded-xl bg-card px-3 sm:px-4" onClick={() => setLocation("/search")} aria-label="Search records"><Search className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Search</span><kbd className="ml-3 hidden rounded-md bg-muted px-1.5 py-0.5 text-[0.62rem] text-muted-foreground lg:inline">⌘ K</kbd></Button>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        {isMobile && <MobileQuickNavigation role={user?.operationalRole} onNavigate={setLocation} />}
      </SidebarInset>
    </>
  );
}

function MobileQuickNavigation({ role, onNavigate }: { role: string | null | undefined; onNavigate: (path: string) => void }) {
  const desktopItems = [
    { label: "Home", path: "/", icon: LayoutDashboard },
    { label: "Rota", path: "/rota", icon: CalendarDays },
    { label: "Keyworker", path: "/keyworker-app", icon: ClipboardCheck },
    { label: "Finance", path: "/finance", icon: HandCoins },
  ];
  const keyworkerItems = [
    { label: "Keyworker", path: "/keyworker-app", icon: ClipboardCheck },
    { label: "Care", path: "/care", icon: HeartPulse },
    { label: "Staff", path: "/staff", icon: UserRound },
  ];
  const items = (role === "support_worker" ? keyworkerItems : desktopItems).filter(item => canViewWorkspaceNavigation(role, item.path)).slice(0, 3);
  items.push({ label: "More", path: "/search", icon: Search });
  return <nav className={`fixed inset-x-3 bottom-3 z-40 grid rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl ${items.length === 3 ? "grid-cols-3" : "grid-cols-4"}`} aria-label="Quick mobile navigation">
    {items.map(item => <button key={item.path} onClick={() => onNavigate(item.path)} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[0.62rem] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><item.icon className="h-4 w-4" />{item.label}</button>)}
  </nav>;
}

function ConnectionStatus() { const [online, setOnline] = useState(() => navigator.onLine); const [reconnected, setReconnected] = useState(false); useEffect(() => { const on = () => { setOnline(true); setReconnected(true); window.setTimeout(() => setReconnected(false), 3500); }; const off = () => { setOnline(false); setReconnected(false); }; window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []); if (online && !reconnected) return null; return <div role="status" className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold ${online ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"}`}>{online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{online ? "Connection restored. Refresh any record that was being edited." : "You are offline. Existing pages remain visible, but do not submit records until connection returns."}</div>; }
