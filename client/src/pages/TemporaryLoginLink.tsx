import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Building2, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useRef } from "react";
import { useParams } from "wouter";

export default function TemporaryLoginLinkPage() {
  const { token } = useParams<{ token: string }>();
  const started = useRef(false);
  const redirecting = useRef(false);
  const redeem = trpc.temporaryLoginLinks.redeem.useMutation();

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    redeem.mutate({ token });
  }, [token]);

  useEffect(() => {
    if (!redeem.data?.success || redirecting.current) return;
    redirecting.current = true;
    window.setTimeout(() => window.location.replace("/"), 450);
  }, [redeem.data]);

  if (!token) return <Unavailable />;
  if (redeem.isPending || !started.current) return <main className="grid min-h-screen place-items-center bg-background p-5"><section className="surface w-full max-w-lg p-8 text-center sm:p-12"><div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" /><h1 className="mt-5 text-2xl font-extrabold">Checking temporary access</h1><p className="thin-copy mt-3">Validating your one-time sign-in link securely.</p></section></main>;
  if (redeem.error || !redeem.data) return <Unavailable />;

  return <main className="grid min-h-screen place-items-center bg-background p-5"><section className="surface w-full max-w-lg p-8 text-center sm:p-12"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-900"><ShieldCheck className="h-6 w-6" /></div><p className="eyebrow mt-6">One-time access confirmed</p><h1 className="mt-3 text-3xl font-extrabold tracking-[-0.05em]">Opening your workspace</h1><p className="thin-copy mt-4">Your normal account permissions still apply. {redeem.data.mustChangePassword ? "You will be asked to set a new password before opening operational records." : "Taking you to the secure workspace now."}</p><div role="status" className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-muted px-4 py-3 text-sm font-bold text-muted-foreground"><KeyRound className="h-4 w-4" />Creating your secure session…</div></section></main>;
}

function Unavailable() {
  return <main className="grid min-h-screen place-items-center bg-background p-5"><section className="surface w-full max-w-lg p-8 text-center sm:p-12"><div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-50 text-destructive"><ShieldAlert className="h-6 w-6" /></div><h1 className="mt-6 text-3xl font-extrabold tracking-[-0.05em]">Temporary sign-in link unavailable</h1><p className="thin-copy mt-4">This link may have expired, been revoked, already been used, or no longer matches an active account. Ask your company administrator for a new link.</p><Button variant="outline" className="mt-6 rounded-xl" onClick={() => window.location.assign("/")}><Building2 className="mr-2 h-4 w-4" />Go to secure sign-in</Button></section></main>;
}
