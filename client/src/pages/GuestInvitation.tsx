import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Building2, ExternalLink, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { useLocation, useParams } from "wouter";

export default function GuestInvitationPage() {
  const { token } = useParams<{ token: string }>();
  const [, setLocation] = useLocation();
  const started = useRef(false);
  const redeem = trpc.guestInvitations.redeem.useMutation();
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    redeem.mutate({ token });
  }, [token]);
  if (!token) return <Unavailable />;
  if (redeem.isPending || !started.current) return <main className="grid min-h-screen place-items-center bg-background p-5"><section className="surface w-full max-w-lg p-8 text-center"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" /><h1 className="mt-5 text-2xl font-extrabold">Opening guest invitation</h1><p className="thin-copy mt-3">Validating this restricted link securely.</p></section></main>;
  if (redeem.error || !redeem.data) return <Unavailable />;
  const { property, organisation, expiresAt, remainingUses } = redeem.data;
  return <main className="min-h-screen bg-background p-5 sm:p-10"><section className="mx-auto max-w-2xl"><div className="mb-5 flex items-center gap-2 text-sm font-bold text-muted-foreground"><span className="grid h-9 w-9 place-items-center rounded-xl bg-sky-100 text-sky-900"><ShieldCheck className="h-5 w-5" /></span>Restricted guest view</div><article className="surface overflow-hidden"><div className="bg-slate-950 p-6 text-white sm:p-8"><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-200">Read-only property summary</p><h1 className="mt-3 text-3xl font-extrabold tracking-[-0.045em] sm:text-4xl">{property.name}</h1><p className="mt-3 text-sm text-slate-300">Provided by {organisation.name}</p></div><div className="grid gap-6 p-6 sm:p-8"><div className="rounded-2xl bg-muted/60 p-5"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Property address</p><p className="mt-2 font-bold">{[property.addressLine1, property.addressLine2, property.city, property.postcode].filter(Boolean).join(", ")}</p></div><dl className="grid gap-4 sm:grid-cols-2"><Info label="Accommodation type" value={property.accommodationType.replaceAll("_", " ")} /><Info label="Operational status" value={property.status} /></dl><div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><p className="font-extrabold">This is a deliberately limited view</p><p className="mt-1 leading-6">It does not contain young-person, placement, safeguarding, health, staffing, rota, finance, document-library, audit or wider company information. It does not create access to the Hub.</p></div><p className="text-xs text-muted-foreground">This link expires {new Date(expiresAt).toLocaleString()}{remainingUses > 0 ? ` and has ${remainingUses} remaining use${remainingUses === 1 ? "" : "s"}.` : "."}</p><Button variant="outline" className="w-full rounded-xl" onClick={() => setLocation("/")}><ExternalLink className="mr-2 h-4 w-4" />Go to secure sign-in</Button></div></article></section></main>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="mt-1 capitalize font-bold">{value}</dd></div>; }
function Unavailable() { return <main className="grid min-h-screen place-items-center bg-background p-5"><section className="surface w-full max-w-lg p-8 text-center sm:p-12"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-destructive"><ShieldAlert className="h-6 w-6" /></div><h1 className="mt-6 text-3xl font-extrabold tracking-[-0.05em]">Guest invitation unavailable</h1><p className="thin-copy mt-4">This link may have expired, been revoked or already reached its allowed number of uses. Ask the organisation that issued it for a new invitation.</p><Button variant="outline" className="mt-6 rounded-xl" onClick={() => window.location.assign("/")}><Building2 className="mr-2 h-4 w-4" />Secure sign-in</Button></section></main>; }
