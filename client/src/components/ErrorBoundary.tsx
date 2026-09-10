import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw, ShieldCheck } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export function getSafeClientErrorCode(error: Error | null) {
  const message = `${error?.name ?? ""} ${error?.message ?? ""}`.toLowerCase();
  return /minified react error #306|lazy element type|dynamically imported module|chunkloaderror|loading chunk/.test(message)
    ? "APP_RELEASE_REFRESH_REQUIRED"
    : "APP_RENDER_FAILURE";
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[Client] Render failure", { code: getSafeClientErrorCode(error), name: error.name });
  }

  render() {
    if (this.state.hasError) {
      const code = getSafeClientErrorCode(this.state.error);
      return (
        <div className="grid min-h-screen place-items-center bg-background p-5 sm:p-8">
          <section className="surface w-full max-w-lg p-8 text-center sm:p-12" role="alert">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-amber-50 text-amber-800"><AlertTriangle className="h-6 w-6" /></div>
            <p className="eyebrow mt-6">Secure recovery</p>
            <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.05em]">The workspace needs a refresh</h1>
            <p className="thin-copy mt-4">{code === "APP_RELEASE_REFRESH_REQUIRED" ? "This browser may have an older version of the application open. Refresh to load the current secure release." : "The workspace could not be displayed safely. Refresh and try again; your account and access controls have not been changed."}</p>
            <p className="mt-4 text-xs font-bold text-muted-foreground">Support code: {code}</p>
            <button onClick={() => window.location.reload()} className={cn("mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-foreground transition active:scale-[0.97] hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2")}><RotateCcw className="h-4 w-4" />Refresh securely</button>
            <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" />Do not share passwords or sensitive record details in a support request.</p>
          </section>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
