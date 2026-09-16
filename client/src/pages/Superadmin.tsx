import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { Building2, ShieldCheck, UsersRound } from "lucide-react";

const statusTone: Record<string, string> = { active: "bg-emerald-100 text-emerald-900", suspended: "bg-amber-100 text-amber-950", invited: "bg-slate-100 text-slate-700", inactive: "bg-slate-100 text-slate-700", draft: "bg-slate-100 text-slate-700" };

export default function Superadmin() {
  const overview = trpc.superadmin.overview.useQuery(undefined, { staleTime: 30_000, retry: false });
  if (overview.isLoading) return <div className="grid gap-5"><Skeleton className="h-28 rounded-2xl" /><Skeleton className="h-72 rounded-2xl" /></div>;
  if (overview.error) return <Card className="border-amber-300 bg-amber-50"><CardHeader><CardTitle>Superadmin monitoring unavailable</CardTitle></CardHeader><CardContent className="text-sm text-amber-950">This dashboard is available only to the approved platform administrator. Company data remains protected by the server.</CardContent></Card>;
  const data = overview.data!;
  const cards = [
    { label: "Active companies", value: `${data.totals.activeCompanies} / ${data.totals.companies}`, icon: Building2 },
    { label: "Active users", value: data.totals.activeUsers, icon: UsersRound },
    { label: "Active memberships", value: data.totals.memberships, icon: ShieldCheck },
  ];
  return <div className="mx-auto grid max-w-7xl gap-6"><header><p className="eyebrow">Restricted platform oversight</p><h1 className="mt-2 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">Superadmin dashboard</h1><p className="thin-copy mt-3 max-w-3xl">Monitor company and account status without exposing young-person, safeguarding, HR, financial-document or operational-record content.</p></header><section className="grid gap-4 sm:grid-cols-3">{cards.map(card => <Card key={card.label} className="rounded-2xl"><CardContent className="flex items-center gap-4 p-5"><div className="grid h-11 w-11 place-items-center rounded-xl bg-sky-100 text-sky-900"><card.icon className="h-5 w-5" /></div><div><p className="text-xs font-semibold text-muted-foreground">{card.label}</p><p className="text-2xl font-extrabold">{card.value}</p></div></CardContent></Card>)}</section><section className="grid gap-6 xl:grid-cols-[1.1fr_1fr]"><Card className="rounded-2xl"><CardHeader><CardTitle>Companies</CardTitle></CardHeader><CardContent className="space-y-3">{data.companies.map(company => <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3" key={company.id}><div className="min-w-0"><p className="truncate font-bold">{company.name}</p><p className="truncate text-xs text-muted-foreground">{company.legalName} · {company.activeMembers} active member{company.activeMembers === 1 ? "" : "s"}</p></div><Badge className={statusTone[company.status] ?? statusTone.draft}>{company.status}</Badge></div>)}</CardContent></Card><Card className="rounded-2xl"><CardHeader><CardTitle>Recent account activity</CardTitle></CardHeader><CardContent className="space-y-3">{data.users.map(user => <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-3" key={user.id}><div className="min-w-0"><p className="truncate font-bold">{user.name ?? "Unnamed user"}</p><p className="truncate text-xs text-muted-foreground">{user.email ?? "No email"} · {user.operationalRole.replaceAll("_", " ")}</p></div><Badge className={statusTone[user.accountStatus] ?? statusTone.invited}>{user.accountStatus}</Badge></div>)}</CardContent></Card></section></div>;
}
