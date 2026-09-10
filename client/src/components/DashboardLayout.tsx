import { useAuth } from "@/_core/hooks/useAuth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton,
  SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar,
} from "@/components/ui/sidebar";
import { WorkspaceProvider, useWorkspace } from "@/contexts/WorkspaceContext";
import { startLogin } from "@/const";
import { getAuthFeedback, isAuthFeedbackCode, type AuthFeedback } from "@shared/authFeedback";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle, BellRing, BookOpenText, Building2, CalendarClock, CalendarDays, ClipboardCheck, FileStack, HandCoins, HeartPulse, House, LayoutDashboard, Loader2, Scale,
  KeyRound, ListTodo, LogOut, Menu, PanelLeft, ScanSearch, Search, ShieldAlert, ShieldCheck, Smartphone, UserRound, UsersRound, Wifi, WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { DashboardLayoutSkeleton } from "./DashboardLayoutSkeleton";

const menuItems = [
  { icon: LayoutDashboard, label: "Overview", path: "/" },
  { icon: Building2, label: "Properties", path: "/properties" },
  { icon: UsersRound, label: "Workforce", path: "/workforce" },
  { icon: KeyRound, label: "Access control", path: "/access-control" },
  { icon: LayoutDashboard, label: "Manager app", path: "/manager-app" },
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
  { icon: Smartphone, label: "Key Worker", path: "/key-worker" },
  { icon: Smartphone, label: "Key Worker app", path: "/keyworker-app" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { loading, user, authIssue } = useAuth();
  if (loading || !user) return <SignInScreen loading={loading} feedback={authIssue} />;
  return <WorkspaceProvider><SidebarProvider><DashboardLayoutContent>{children}</DashboardLayoutContent></SidebarProvider></WorkspaceProvider>;
}

function SignInScreen({ loading, feedback }: { loading: boolean; feedback: AuthFeedback | null }) {
  const [redirecting, setRedirecting] = useState(false);
  const [queryFeedback, setQueryFeedback] = useState<AuthFeedback | null>(null);

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

  const visibleFeedback = feedback ?? queryFeedback;
  const busy = loading || redirecting;
  const beginSignIn = () => {
    // If the browser cannot reach the provider at all, no callback can return
    // an error code. Preserve a safe fallback for the user when they return.
    window.sessionStorage.setItem("hub-auth-feedback", "AUTH_SERVICE_UNAVAILABLE");
    setRedirecting(true);
    startLogin();
  };
  const beginRecovery = () => {
    window.sessionStorage.setItem("hub-auth-feedback", "AUTH_SERVICE_UNAVAILABLE");
    setRedirecting(true);
    startLogin();
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
        <p className="thin-copy mt-5 max-w-md">Use passwordless secure sign-in through your organisation’s identity provider to access only the entities, properties and records specifically assigned to your role.</p>
        {visibleFeedback && <div role="alert" className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-extrabold">{visibleFeedback.title}</p><p className="mt-1 text-sm leading-5">{visibleFeedback.message}</p><p className="mt-3 font-mono text-xs font-bold">Developer code: {visibleFeedback.code}</p></div></div></div>}
        {loading && !visibleFeedback && <div role="status" className="mt-6 flex items-center gap-3 rounded-2xl bg-muted px-4 py-3 text-sm font-semibold text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Checking your secure session…</div>}
        <Button onClick={beginSignIn} disabled={busy} size="lg" className="mt-8 h-12 w-full rounded-xl text-base font-bold">{busy ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />{redirecting ? "Opening passwordless sign-in…" : "Checking secure session…"}</> : (visibleFeedback?.actionLabel ?? "Passwordless secure sign-in")}</Button>
        {visibleFeedback && <div className="mt-3 grid gap-2 sm:grid-cols-2"><Button variant="outline" onClick={beginRecovery} disabled={busy} className="rounded-xl text-sm font-semibold">Account recovery</Button><Button variant="ghost" onClick={requestHelp} className="rounded-xl text-sm font-semibold">Email a support request</Button><p className="sm:col-span-2 text-xs leading-5 text-muted-foreground">Account recovery continues with your secure identity provider. The Hub never stores or resets passwords.</p></div>}
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> The Hub does not store passwords. Access and sensitive record views are logged.</div>
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

function DashboardLayoutContent({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const { state, toggleSidebar } = useSidebar();
  const { entities, entityId, entity, setEntityId, loading } = useWorkspace();
  const isCollapsed = state === "collapsed";
  const isMobile = useIsMobile();
  if (!loading && entities.length === 0 && user?.operationalRole !== "owner") return <NoWorkspaceAccess onSignOut={logout} />;
  const userNotifications = trpc.workspace.notifications.useQuery(undefined, { staleTime: 30_000 });
  const unreadNotificationCount = userNotifications.data?.filter(item => !item.readAt).length ?? 0;
  const [accessFeedback, setAccessFeedback] = useState<AuthFeedback | null>(null);
  useEffect(() => {
    const onFeedback = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      if (isAuthFeedbackCode(code)) setAccessFeedback(getAuthFeedback(code));
    };
    window.addEventListener("hub-auth-feedback", onFeedback);
    return () => window.removeEventListener("hub-auth-feedback", onFeedback);
  }, []);
  const matchesLocation = (path: string) => path === location || (path !== "/" && location.startsWith(`${path}/`));
  const active = menuItems.find(item => matchesLocation(item.path));

  return (
    <>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border/70 bg-sidebar">
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
            {menuItems.map(item => {
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
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border/60 bg-background/88 px-4 backdrop-blur-xl sm:px-6">
          <SidebarTrigger className="h-10 w-10 rounded-xl"><Menu className="h-5 w-5" /></SidebarTrigger>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold">{active?.label ?? "Workspace"}</p><p className="truncate text-[0.68rem] text-muted-foreground">{entities.find(entity => entity.id === entityId)?.name ?? "Set up your first entity"}</p></div>
          <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0 rounded-xl bg-card" onClick={() => setLocation("/search?tab=notifications")} aria-label={unreadNotificationCount ? `${unreadNotificationCount} unread notifications` : "Notifications"}><BellRing className="h-4 w-4" />{unreadNotificationCount ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[0.65rem] font-extrabold text-primary-foreground">{unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}</span> : null}</Button>
          <Button variant="outline" className="h-10 rounded-xl bg-card px-3 sm:px-4" onClick={() => setLocation("/search")} aria-label="Search records"><Search className="h-4 w-4 sm:mr-2" /><span className="hidden sm:inline">Search</span><kbd className="ml-3 hidden rounded-md bg-muted px-1.5 py-0.5 text-[0.62rem] text-muted-foreground lg:inline">⌘ K</kbd></Button>
        </header>
        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        {isMobile && <nav className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl" aria-label="Quick mobile navigation">
          {[{ label: "Home", path: "/", icon: LayoutDashboard }, { label: "Rota", path: "/rota", icon: CalendarDays }, { label: "Report", path: "/key-worker", icon: ClipboardCheck }, { label: "More", path: "/search", icon: Search }].map(item => <button key={item.path} onClick={() => setLocation(item.path)} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl text-[0.62rem] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"><item.icon className="h-4 w-4" />{item.label}</button>)}
        </nav>}
      </SidebarInset>
    </>
  );
}

function ConnectionStatus() { const [online, setOnline] = useState(() => navigator.onLine); const [reconnected, setReconnected] = useState(false); useEffect(() => { const on = () => { setOnline(true); setReconnected(true); window.setTimeout(() => setReconnected(false), 3500); }; const off = () => { setOnline(false); setReconnected(false); }; window.addEventListener("online", on); window.addEventListener("offline", off); return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []); if (online && !reconnected) return null; return <div role="status" className={`flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold ${online ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950"}`}>{online ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}{online ? "Connection restored. Refresh any record that was being edited." : "You are offline. Existing pages remain visible, but do not submit records until connection returns."}</div>; }
